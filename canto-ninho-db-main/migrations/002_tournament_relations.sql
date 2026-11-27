-- Relational projections for reports. Sync records remain the write entry point.
CREATE TABLE IF NOT EXISTS tournament_events (
 owner_id TEXT NOT NULL REFERENCES accounts(id),
 tournament_id TEXT NOT NULL,
 name TEXT,
 event_date TEXT,
 status TEXT,
 PRIMARY KEY(owner_id,tournament_id)
);
CREATE INDEX IF NOT EXISTS tournament_events_date ON tournament_events(owner_id,event_date);
CREATE TABLE IF NOT EXISTS tournament_participations (
 owner_id TEXT NOT NULL,
 tournament_id TEXT NOT NULL,
 bird_id TEXT NOT NULL,
 bird_name TEXT,
 ring TEXT,
 PRIMARY KEY(owner_id,tournament_id,bird_id),
 FOREIGN KEY(owner_id,tournament_id) REFERENCES tournament_events(owner_id,tournament_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS tournament_participations_bird ON tournament_participations(owner_id,bird_id,tournament_id);
CREATE TABLE IF NOT EXISTS tournament_results (
 owner_id TEXT NOT NULL,
 tournament_id TEXT NOT NULL,
 bird_id TEXT NOT NULL,
 score REAL,
 songs INTEGER,
 placement INTEGER,
 competitors INTEGER,
 prize TEXT,
 notes TEXT,
 PRIMARY KEY(owner_id,tournament_id,bird_id),
 FOREIGN KEY(owner_id,tournament_id,bird_id)
 REFERENCES tournament_participations(owner_id,tournament_id,bird_id) ON DELETE CASCADE
);

CREATE VIEW IF NOT EXISTS tournament_source AS
 SELECT owner_id,record_id,value FROM sync_records WHERE collection='tournaments' AND value IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS tournament_project_insert
AFTER INSERT ON sync_records WHEN NEW.collection='tournaments' AND NEW.value IS NOT NULL
BEGIN
 INSERT INTO tournament_events SELECT NEW.owner_id,NEW.record_id,
  json_extract(NEW.value,'$.name'),json_extract(NEW.value,'$.date'),json_extract(NEW.value,'$.status');
 INSERT OR IGNORE INTO tournament_participations
 SELECT NEW.owner_id,NEW.record_id,json_extract(p.value,'$.birdId'),json_extract(p.value,'$.name'),json_extract(p.value,'$.ring')
 FROM json_each(NEW.value,'$.participants') AS p
 WHERE json_type(p.value,'$.birdId')='text' AND json_extract(p.value,'$.birdId')<>'';
 INSERT OR IGNORE INTO tournament_results
 SELECT NEW.owner_id,NEW.record_id,json_extract(p.value,'$.birdId'),
  NULLIF(json_extract(p.value,'$.result.score'),''),NULLIF(json_extract(p.value,'$.result.songs'),''),
  NULLIF(json_extract(p.value,'$.result.place'),''),NULLIF(json_extract(p.value,'$.result.competitors'),''),
  json_extract(p.value,'$.result.prize'),json_extract(p.value,'$.result.notes')
 FROM json_each(NEW.value,'$.participants') AS p
 WHERE json_type(p.value,'$.result')='object' AND EXISTS (
  SELECT 1 FROM tournament_participations x WHERE x.owner_id=NEW.owner_id
   AND x.tournament_id=NEW.record_id AND x.bird_id=json_extract(p.value,'$.birdId')
 );
END;

CREATE TRIGGER IF NOT EXISTS tournament_project_update
AFTER UPDATE OF value ON sync_records WHEN NEW.collection='tournaments' AND NEW.value IS NOT OLD.value
BEGIN
 DELETE FROM tournament_events WHERE owner_id=NEW.owner_id AND tournament_id=NEW.record_id;
 INSERT INTO tournament_events SELECT NEW.owner_id,NEW.record_id,
  json_extract(NEW.value,'$.name'),json_extract(NEW.value,'$.date'),json_extract(NEW.value,'$.status')
 WHERE NEW.value IS NOT NULL;
 INSERT OR IGNORE INTO tournament_participations
 SELECT NEW.owner_id,NEW.record_id,json_extract(p.value,'$.birdId'),json_extract(p.value,'$.name'),json_extract(p.value,'$.ring')
 FROM json_each(NEW.value,'$.participants') AS p
 WHERE json_type(p.value,'$.birdId')='text' AND json_extract(p.value,'$.birdId')<>'';
 INSERT OR IGNORE INTO tournament_results
 SELECT NEW.owner_id,NEW.record_id,json_extract(p.value,'$.birdId'),
  NULLIF(json_extract(p.value,'$.result.score'),''),NULLIF(json_extract(p.value,'$.result.songs'),''),
  NULLIF(json_extract(p.value,'$.result.place'),''),NULLIF(json_extract(p.value,'$.result.competitors'),''),
  json_extract(p.value,'$.result.prize'),json_extract(p.value,'$.result.notes')
 FROM json_each(NEW.value,'$.participants') AS p
 WHERE json_type(p.value,'$.result')='object' AND EXISTS (
  SELECT 1 FROM tournament_participations x WHERE x.owner_id=NEW.owner_id
   AND x.tournament_id=NEW.record_id AND x.bird_id=json_extract(p.value,'$.birdId')
 );
END;

-- Rebuild on initial installation, including events written after migration 001.
INSERT OR IGNORE INTO tournament_events
 SELECT owner_id,record_id,json_extract(value,'$.name'),json_extract(value,'$.date'),json_extract(value,'$.status')
 FROM tournament_source;
INSERT OR IGNORE INTO tournament_participations
 SELECT s.owner_id,s.record_id,json_extract(p.value,'$.birdId'),json_extract(p.value,'$.name'),json_extract(p.value,'$.ring')
 FROM tournament_source s,json_each(s.value,'$.participants') p
 WHERE json_type(p.value,'$.birdId')='text' AND json_extract(p.value,'$.birdId')<>'';
INSERT OR IGNORE INTO tournament_results
 SELECT s.owner_id,s.record_id,json_extract(p.value,'$.birdId'),
  NULLIF(json_extract(p.value,'$.result.score'),''),NULLIF(json_extract(p.value,'$.result.songs'),''),
  NULLIF(json_extract(p.value,'$.result.place'),''),NULLIF(json_extract(p.value,'$.result.competitors'),''),
  json_extract(p.value,'$.result.prize'),json_extract(p.value,'$.result.notes')
 FROM tournament_source s,json_each(s.value,'$.participants') p
 JOIN tournament_participations x ON x.owner_id=s.owner_id AND x.tournament_id=s.record_id
  AND x.bird_id=json_extract(p.value,'$.birdId')
 WHERE json_type(p.value,'$.result')='object';

CREATE TRIGGER IF NOT EXISTS tournament_project_delete
AFTER DELETE ON sync_records WHEN OLD.collection='tournaments'
BEGIN
 DELETE FROM tournament_events WHERE owner_id=OLD.owner_id AND tournament_id=OLD.record_id;
END;
