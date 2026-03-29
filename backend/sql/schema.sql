CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS system_configs (
  key VARCHAR(255) PRIMARY KEY,
  value TEXT NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'string'
);

CREATE TABLE IF NOT EXISTS strategy_assets (
  id BIGSERIAL PRIMARY KEY,
  asset_key VARCHAR(128) NOT NULL,
  version VARCHAR(64) NOT NULL,
  asset_type VARCHAR(32) NOT NULL DEFAULT 'prompt',
  title VARCHAR(255) NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  source_path VARCHAR(255) NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategy_assets_asset_key ON strategy_assets(asset_key);
CREATE INDEX IF NOT EXISTS idx_strategy_assets_asset_key_version ON strategy_assets(asset_key, version);

CREATE TABLE IF NOT EXISTS user_profiles (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL UNIQUE,
  display_name VARCHAR(255),
  tier VARCHAR(50) NOT NULL DEFAULT 'Free',
  token_balance NUMERIC(10, 2) NOT NULL DEFAULT 0,
  notification_channels JSONB NOT NULL DEFAULT '{}'::jsonb,
  matching_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);

CREATE TABLE IF NOT EXISTS interview_sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'IN_PROGRESS',
  current_stage VARCHAR(32) NOT NULL DEFAULT 'DIVERGENT',
  turn_count INTEGER NOT NULL DEFAULT 0,
  max_turns INTEGER NOT NULL DEFAULT 30,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interview_sessions_user_id ON interview_sessions(user_id);

CREATE TABLE IF NOT EXISTS insight_reports (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  raw_content JSONB NOT NULL,
  v_feature vector(7),
  v_embedding vector(1536),
  consistency_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insight_reports_user_id ON insight_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_insight_reports_public ON insight_reports(is_public);
CREATE INDEX IF NOT EXISTS idx_insight_reports_v_embedding_cosine ON insight_reports USING ivfflat (v_embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS exposure_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  report_id VARCHAR(64) NOT NULL,
  channel VARCHAR(32) NOT NULL,
  action VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS match_records (
  id VARCHAR(64) PRIMARY KEY,
  user_id_a VARCHAR(64) NOT NULL,
  user_id_b VARCHAR(64) NOT NULL,
  source_report_id VARCHAR(64),
  resonance_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  match_analysis JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(32) NOT NULL DEFAULT 'complete',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_records_user_id_a ON match_records(user_id_a);
CREATE INDEX IF NOT EXISTS idx_match_records_user_id_b ON match_records(user_id_b);

CREATE TABLE IF NOT EXISTS social_threads (
  id VARCHAR(64) PRIMARY KEY,
  user_id_a VARCHAR(64) NOT NULL,
  user_id_b VARCHAR(64) NOT NULL,
  match_id VARCHAR(64),
  unlock_stage INTEGER NOT NULL DEFAULT 0,
  icebreakers JSONB NOT NULL DEFAULT '[]'::jsonb,
  tension_report JSONB NOT NULL DEFAULT '{}'::jsonb,
  unlock_milestones JSONB NOT NULL DEFAULT '[]'::jsonb,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_threads_user_id_a ON social_threads(user_id_a);
CREATE INDEX IF NOT EXISTS idx_social_threads_user_id_b ON social_threads(user_id_b);
