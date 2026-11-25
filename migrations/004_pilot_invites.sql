CREATE TABLE IF NOT EXISTS pilot_invites (
 login TEXT PRIMARY KEY,
 token_hash TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL,
 redeemed_at INTEGER
);

CREATE TRIGGER IF NOT EXISTS pilot_invite_redeemed
AFTER INSERT ON accounts
WHEN substr(NEW.id, 1, 6) = 'pilot:'
BEGIN
 UPDATE pilot_invites SET redeemed_at = unixepoch()
 WHERE login = substr(NEW.id, 7);
END;
