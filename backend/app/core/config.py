from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = 'Ariadne API'
    app_env: str = 'development'
    api_prefix: str = '/api/v1'
    postgres_dsn: str = 'postgresql+psycopg://ariadne:ariadne@db:5432/ariadne'
    redis_url: str = 'redis://redis:6379/0'
    llm_api_endpoint: str = 'http://host.docker.internal:11434/v1/chat/completions'
    llm_api_key: str = 'dev-key'
    llm_model_interview: str = 'gpt-4.1-mini'
    llm_model_match: str = 'gpt-4.1'
    vector_search_engine: str = 'pgvector'
    vector_dimension: int = 1536
    token_cost_interview_turn: int = 1
    token_cost_discover: int = 5
    token_cost_generate_report: int = 20
    token_cost_deep_match: int = 50
    match_decay_factor: float = 0.05
    match_resonance_threshold: float = 0.55
    consistency_min_threshold: float = 0.6
    report_worker_poll_interval_seconds: float = 2.0
    notification_worker_poll_interval_seconds: float = 2.0
    notification_max_retries: int = 3
    notification_retry_backoff_seconds: float = 30.0
    ad_reward_daily_limit: int = 3
    ad_reward_token_reward: int = 15
    notify_email_endpoint: str = ''
    notify_telegram_endpoint: str = ''
    notify_wechat_endpoint: str = ''

    model_config = SettingsConfigDict(env_file='.env', env_prefix='ARIADNE_', extra='ignore')


@lru_cache
def get_settings() -> Settings:
    return Settings()
