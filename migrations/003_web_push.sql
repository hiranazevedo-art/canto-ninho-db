CREATE TABLE IF NOT EXISTS push_subscriptions (
 owner_id TEXT NOT NULL REFERENCES accounts(id),
 device_id TEXT NOT NULL,
 endpoint TEXT NOT NULL UNIQUE,
 p256dh TEXT NOT NULL,
 auth_key TEXT NOT NULL,
 last_test_at INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(owner_id,device_id)
);
CREATE TABLE IF NOT EXISTS push_deliveries (
 owner_id TEXT NOT NULL,
 device_id TEXT NOT NULL,
 reminder_key TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id,device_id,reminder_key),
 FOREIGN KEY(owner_id,device_id) REFERENCES push_subscriptions(owner_id,device_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS push_deliveries_age ON push_deliveries(created_at);
