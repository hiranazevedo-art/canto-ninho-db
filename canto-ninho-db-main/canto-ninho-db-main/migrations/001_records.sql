-- Additive migration. Existing snapshots remain available for recovery.
CREATE TABLE IF NOT EXISTS sync_heads (
 owner_id TEXT PRIMARY KEY REFERENCES accounts(id),
 revision INTEGER NOT NULL,
 changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sync_records (
 owner_id TEXT NOT NULL REFERENCES accounts(id),
 collection TEXT NOT NULL,
 record_id TEXT NOT NULL,
 value TEXT CHECK(value IS NULL OR json_valid(value)),
 revision INTEGER NOT NULL,
 position INTEGER NOT NULL,
 PRIMARY KEY(owner_id, collection, record_id)
);
CREATE INDEX IF NOT EXISTS sync_records_revision ON sync_records(owner_id, revision);
CREATE TABLE IF NOT EXISTS sync_operations (
 owner_id TEXT NOT NULL REFERENCES accounts(id),
 revision INTEGER NOT NULL,
 operation_id TEXT NOT NULL,
 digest TEXT NOT NULL,
 -- NULL marks an explicit replacement requiring a fresh download.
 changes TEXT CHECK(changes IS NULL OR json_valid(changes)),
 PRIMARY KEY(owner_id, revision),
 UNIQUE(owner_id, operation_id)
);
CREATE TRIGGER IF NOT EXISTS snapshots_freeze_after_migration
BEFORE UPDATE ON snapshots
WHEN EXISTS(SELECT 1 FROM sync_heads WHERE owner_id=OLD.owner_id)
BEGIN
 SELECT RAISE(ABORT,'Snapshot legado protegido');
END;
