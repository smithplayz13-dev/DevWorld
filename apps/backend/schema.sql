-- DevWorld core DDL (portable PostgreSQL; SQLite-compatible subset).
-- DATA_MODEL.md owns column meaning. This file documents the demo/local
-- schema; production migrations live under apps/backend/migrations/.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  github_user_id TEXT UNIQUE NOT NULL,
  login TEXT,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS worlds (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  github_account_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  world_seed TEXT NOT NULL,
  layout_epoch INTEGER NOT NULL DEFAULT 1,
  policy_generation BIGINT NOT NULL DEFAULT 1,
  source_preview_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'ready',
  active_version_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, github_account_id)
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  repository_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN
    ('world','repository','directory','file','class','component','function')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
