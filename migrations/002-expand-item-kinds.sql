-- One-time existing-MS WQ D1 migration for v1.2+ custom content kinds.
-- The production MSWQ D1 database was migrated separately; DO NOT apply this twice.
-- Run ONLY against an older database where sqlite_master still shows
-- CHECK(kind IN ('personal','group','document','page','link')).
-- Back up the database before applying this one-time schema migration.
-- This touches only the MSWQ "items" table; do not run on DOCX or other D1 databases.

CREATE TABLE IF NOT EXISTS items_backup_kind_v1 AS SELECT * FROM items;
CREATE TABLE items_kind_v2 (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
 title TEXT NOT NULL,
 slug TEXT NOT NULL UNIQUE,
 description TEXT NOT NULL DEFAULT '',
 category TEXT NOT NULL DEFAULT '',
 tags TEXT NOT NULL DEFAULT '[]',
 sort_order INTEGER NOT NULL DEFAULT 1000,
 thumbnail TEXT NOT NULL DEFAULT '',
 content TEXT NOT NULL DEFAULT '{"blocks":[]}',
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1
);

INSERT INTO items_kind_v2(id,kind,status,title,slug,description,category,tags,sort_order,thumbnail,content,created_at,updated_at,version)
SELECT id,kind,status,title,slug,description,category,tags,sort_order,thumbnail,content,created_at,updated_at,version
FROM items;

-- Before continuing, compare SELECT COUNT(*) and row contents
-- between items and items_kind_v2 and ensure they are identical.
-- This migration must be executed in two phases or an atomic D1 batch.
-- Phase 2:
-- DROP TABLE items;
-- ALTER TABLE items_kind_v2 RENAME TO items;
-- CREATE INDEX idx_items_public ON items(status,sort_order,updated_at);
