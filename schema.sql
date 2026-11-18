-- Isolated MSWQ schema. Do not apply to other D1 databases.
CREATE TABLE IF NOT EXISTS items (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('personal','group','document','page','link')),
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
CREATE INDEX IF NOT EXISTS idx_items_public ON items(status,sort_order,updated_at);
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,key TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS revisions (id TEXT PRIMARY KEY,item_id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_revisions_item ON revisions(item_id,created_at DESC);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT PRIMARY KEY,failures INTEGER NOT NULL DEFAULT 0,locked_until INTEGER NOT NULL DEFAULT 0);