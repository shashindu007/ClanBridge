-- T1.8 — Operational tables: sync_log, audit_log.
--
-- Neither table holds game data, but between them they are what stops the two
-- unrecoverable failures: a sync job dying unnoticed during CWL, and nobody
-- being able to say who changed what.

-- ---------------------------------------------------------------------------
-- sync_log — R9. Every job writes here at start and finish.
--
-- Drives the freshness indicator on every page (T4.8) and the failure push
-- alert (T5.8). A job that fails silently during CWL costs a season of data
-- that cannot be re-fetched from anywhere.
--
-- NOTE THE 'skipped' STATUS. R10: notInWar, warEnded, preparation and a missing
-- CWL group are ordinary conditions for most of the month, not failures. They
-- must be recorded as skipped, never as failed — a job that reports failure
-- three weeks out of four trains you to ignore the alerts that matter.
-- ---------------------------------------------------------------------------
create table sync_log (
  id               uuid primary key default gen_random_uuid(),
  job_type         text not null check (job_type in ('clans', 'cwl', 'war', 'raids', 'clan-games', 'backup')),
  clan_id          uuid references clans (id) on delete restrict,  -- null for family-wide jobs
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  status           text not null check (status in ('running', 'success', 'skipped', 'failed')),
  skip_reason      text,          -- 'notInWar', 'noCwlGroup', ... when status = 'skipped'
  error            text,          -- R8: never put a player API token in here
  records_written  integer,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

-- The freshness query is "latest successful run of job X for clan Y", so index
-- for that shape directly.
create index sync_log_freshness_idx
  on sync_log (job_type, clan_id, finished_at desc)
  where status = 'success';

create index sync_log_started_at_idx on sync_log (started_at desc);


-- ---------------------------------------------------------------------------
-- audit_log — R4. Every write is recorded: who, what, when.
--
-- Read by the viewer at T9.6. Without that page this record exists but is
-- invisible, and the protection against a departing member is theoretical.
--
-- before/after are jsonb snapshots of the changed row. Keep them small — store
-- the changed fields, not the entire entity.
--
-- deleted_at is present for consistency with section 4, but NOTHING SHOULD EVER
-- SET IT. An audit log you can quietly remove entries from is not an audit log.
-- ---------------------------------------------------------------------------
create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users (id) on delete restrict,
  clan_id     uuid references clans (id) on delete restrict,
  action      text not null,          -- 'create' | 'update' | 'delete' | 'publish' | ...
  entity      text not null,          -- table name, e.g. 'cwl_bonuses'
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index audit_log_clan_id_idx on audit_log (clan_id, created_at desc);
create index audit_log_user_id_idx on audit_log (user_id, created_at desc);
create index audit_log_entity_idx on audit_log (entity, entity_id);
