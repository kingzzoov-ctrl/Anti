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
