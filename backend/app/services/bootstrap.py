from pathlib import Path

from sqlalchemy.orm import Session

from app.services.storage_service import upsert_strategy_asset, upsert_system_config

DEFAULT_CONFIGS = {
    'RUNTIME_FN_INTERVIEW_URL': '/api/v1/ariadne/interview/turn',
    'RUNTIME_FN_MATCH_URL': '/api/v1/ariadne/match/discover',
    'PROMPT_ASSET_VERSION': '2026-03-29.prompt-unified.v1',
    'REPORT_SCHEMA_VERSION': 'ariadne-report-v3',
    'LLM_MODEL_INTERVIEW': 'gpt-4.1-mini',
    'LLM_MODEL_MATCH': 'gpt-4.1',
    'VECTOR_SEARCH_ENGINE': 'pgvector',
    'VECTOR_DIMENSION': '1536',
    'TOKEN_COST_INTERVIEW_TURN': '1',
    'TOKEN_COST_DISCOVER': '5',
    'TOKEN_COST_GENERATE_REPORT': '20',
    'TOKEN_COST_DEEP_MATCH': '50',
    'MATCH_DECAY_FACTOR': '0.05',
    'MATCH_RESONANCE_THRESHOLD': '0.55',
    'CONSISTENCY_MIN_THRESHOLD': '0.6',
    'REPORT_WORKER_POLL_INTERVAL_SECONDS': '2',
    'NOTIFICATION_WORKER_POLL_INTERVAL_SECONDS': '2',
    'NOTIFICATION_MAX_RETRIES': '3',
    'NOTIFICATION_RETRY_BACKOFF_SECONDS': '30',
    'WEEKLY_DIGEST_LOOKBACK_DAYS': '7',
    'AD_REWARD_DAILY_LIMIT': '3',
    'AD_REWARD_TOKEN_REWARD': '15',
    'SOCIAL_ACTIVE_THREAD_LIMIT': '3',
    'NOTIFY_EMAIL_ENDPOINT': '',
    'NOTIFY_TELEGRAM_ENDPOINT': '',
    'NOTIFY_WECHAT_ENDPOINT': '',
}


def bootstrap_defaults(db: Session) -> None:
    for key, value in DEFAULT_CONFIGS.items():
        upsert_system_config(db, key, value)

    project_root = Path(__file__).resolve().parents[3]
    assets = [
        {
            'asset_key': 'interview_skill',
            'version': '2026-03-29.skill.interview.v1',
            'asset_type': 'skill',
            'title': 'Ariadne 问询对话 Skill',
            'source_path': 'Ariadne基座/skills/interview.skill.md',
        },
        {
            'asset_key': 'analysis_framework',
            'version': '2026-03-29.knowledge.framework.v1',
            'asset_type': 'knowledge',
            'title': 'Ariadne 择偶心理分析框架',
            'source_path': 'Ariadne基座/knowledge/framework.md',
        },
    ]

    for asset in assets:
        absolute_path = project_root / asset['source_path']
        if not absolute_path.exists():
            continue
        upsert_strategy_asset(
            db,
            asset_key=asset['asset_key'],
            version=asset['version'],
            asset_type=asset['asset_type'],
            title=asset['title'],
            content=absolute_path.read_text(encoding='utf-8'),
            source_path=asset['source_path'],
            is_active=True,
        )
