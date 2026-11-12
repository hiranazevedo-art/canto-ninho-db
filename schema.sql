CREATE TABLE IF NOT EXISTS accounts (
 id TEXT PRIMARY KEY,
 password_salt TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS snapshots (
 owner_id TEXT PRIMARY KEY REFERENCES accounts(id),
 revision INTEGER NOT NULL DEFAULT 1,
 payload TEXT NOT NULL,
 changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
