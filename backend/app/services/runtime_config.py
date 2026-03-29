from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.system_config import SystemConfig

settings = get_settings()

RUNTIME_CONFIG_SPECS: dict[str, dict[str, Any]] = {
    'LLM_API_ENDPOINT': {
        'default': settings.llm_api_endpoint,
        'type': 'string',
        'description': '统一 LLM 网关地址，供问询与匹配推演运行时复用。',
    },
    'LLM_MODEL_INTERVIEW': {
        'default': settings.llm_model_interview,
        'type': 'string',
        'description': '问询链路使用的主模型标识。',
    },
    'LLM_MODEL_MATCH': {
        'default': settings.llm_model_match,
        'type': 'string',
        'description': '匹配与深度推演链路使用的主模型标识。',
    },
    'VECTOR_DIMENSION': {
        'default': settings.vector_dimension,
        'type': 'int',
        'description': '报告向量与召回向量维度。',
    },
    'VECTOR_SEARCH_ENGINE': {
        'default': settings.vector_search_engine,
        'type': 'string',
        'description': '向量召回引擎选择：`pgvector` / `memory` / `hybrid`。',
    },
    'TOKEN_COST_INTERVIEW_TURN': {
        'default': settings.token_cost_interview_turn,
        'type': 'int',
        'description': '每次问询轮次的 Token 扣费。',
    },
    'TOKEN_COST_DISCOVER': {
        'default': settings.token_cost_discover,
        'type': 'int',
        'description': '每次发现页召回的 Token 扣费。',
    },
    'TOKEN_COST_GENERATE_REPORT': {
        'default': settings.token_cost_generate_report,
        'type': 'int',
        'description': '每次生成洞见报告的 Token 扣费。',
    },
    'TOKEN_COST_DEEP_MATCH': {
        'default': settings.token_cost_deep_match,
        'type': 'int',
        'description': '每次深度匹配推演的 Token 扣费。',
    },
    'MATCH_DECAY_FACTOR': {
        'default': settings.match_decay_factor,
        'type': 'float',
        'description': '发现链路曝光疲劳衰减系数。',
    },
    'MATCH_RESONANCE_THRESHOLD': {
        'default': settings.match_resonance_threshold,
        'type': 'float',
        'description': '进入匹配候选的最小共振阈值。',
    },
    'CONSISTENCY_MIN_THRESHOLD': {
        'default': settings.consistency_min_threshold,
        'type': 'float',
        'description': '进入召回池的最低自洽度阈值。',
    },
    'REPORT_WORKER_POLL_INTERVAL_SECONDS': {
        'default': settings.report_worker_poll_interval_seconds,
        'type': 'float',
        'description': '报告 worker 轮询队列的时间间隔。',
    },
    'NOTIFICATION_WORKER_POLL_INTERVAL_SECONDS': {
        'default': settings.notification_worker_poll_interval_seconds,
        'type': 'float',
        'description': '通知 worker 轮询队列的时间间隔。',
    },
    'NOTIFICATION_MAX_RETRIES': {
        'default': settings.notification_max_retries,
        'type': 'int',
        'description': '通知事件最大重试次数。',
    },
    'NOTIFICATION_RETRY_BACKOFF_SECONDS': {
        'default': settings.notification_retry_backoff_seconds,
        'type': 'float',
        'description': '通知失败后再次入队的退避秒数。',
    },
    'WEEKLY_DIGEST_LOOKBACK_DAYS': {
        'default': 7,
        'type': 'int',
        'description': 'Free 周报摘要回看窗口天数。',
    },
    'AD_REWARD_DAILY_LIMIT': {
        'default': settings.ad_reward_daily_limit,
        'type': 'int',
        'description': 'Ad-Reward 用户每天可领取激励任务的上限。',
    },
    'AD_REWARD_TOKEN_REWARD': {
        'default': settings.ad_reward_token_reward,
        'type': 'int',
        'description': '单次 Ad-Reward 任务成功后授予的 Token 数量。',
    },
    'SOCIAL_ACTIVE_THREAD_LIMIT': {
        'default': 3,
        'type': 'int',
        'description': '单用户同时占用的深度社交通道上限；达到上限后将暂时退出 discover 匹配池。',
    },
    'NOTIFY_EMAIL_ENDPOINT': {
        'default': settings.notify_email_endpoint,
        'type': 'string',
        'description': '邮件通知发送器 webhook 端点。',
    },
    'NOTIFY_TELEGRAM_ENDPOINT': {
        'default': settings.notify_telegram_endpoint,
        'type': 'string',
        'description': 'Telegram 通知发送器 webhook 端点。',
    },
    'NOTIFY_WECHAT_ENDPOINT': {
        'default': settings.notify_wechat_endpoint,
        'type': 'string',
        'description': '企业微信/微信通知发送器 webhook 端点。',
    },
}


def _coerce_runtime_value(value: Any, value_type: str) -> Any:
    if value_type == 'int':
        try:
            return int(value)
        except (TypeError, ValueError):
            return 0
    if value_type == 'float':
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0
    if value_type == 'bool':
        return str(value).strip().lower() in {'1', 'true', 'yes', 'on'}
    return '' if value is None else str(value)


def get_runtime_config(db: Session | None = None) -> dict[str, str | int | float | bool]:
    config = {
        key: spec['default']
        for key, spec in RUNTIME_CONFIG_SPECS.items()
    }
    if db is None:
        return config

    rows = db.scalars(select(SystemConfig).order_by(SystemConfig.key.asc())).all()
    for row in rows:
        if row.key in RUNTIME_CONFIG_SPECS:
            config[row.key] = _coerce_runtime_value(row.value, row.type)
        else:
            config[row.key] = _coerce_runtime_value(row.value, row.type)
    return config


def list_runtime_configs(db: Session | None = None) -> list[dict[str, Any]]:
    merged = get_runtime_config(db)
    stored_map: dict[str, SystemConfig] = {}
    if db is not None:
        stored_map = {item.key: item for item in db.scalars(select(SystemConfig).order_by(SystemConfig.key.asc())).all()}

    items: list[dict[str, Any]] = []
    for key in sorted(set(list(RUNTIME_CONFIG_SPECS.keys()) + list(stored_map.keys()))):
        spec = RUNTIME_CONFIG_SPECS.get(key, {})
        stored = stored_map.get(key)
        value_type = stored.type if stored is not None else str(spec.get('type', 'string'))
        items.append(
            {
                'key': key,
                'value': str(merged.get(key, '')),
                'type': value_type,
                'description': spec.get('description'),
                'source': 'system-config' if stored is not None else 'env-default',
                'updatedAt': None,
            }
        )
    return items
