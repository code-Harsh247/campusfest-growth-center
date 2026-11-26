-- App-owned tables: what the loader found, editable assumptions, and the edit log.
-- Source data lives in the `original` (read-only after load) and `working`
-- (editable) schemas, generated from src/foundation/spec.ts.

create schema if not exists app;

create table if not exists app.load_report (
  table_name      text primary key,
  source          text not null,
  loaded_at       timestamptz not null default now(),
  raw_rows        integer not null,
  unique_rows     integer not null,
  repeated_rows   integer not null,   -- identical rows sharing a stable ID (import retries)
  conflicting_ids integer not null    -- IDs repeated with different content; first copy kept
);

-- Every value the metrics depend on that is not in the dataset.
-- tag: D = from the dataset, R = research, A = our assumption, S = simulated.
create table if not exists app.assumptions (
  key        text primary key,
  value      text not null,
  kind       text not null check (kind in ('number', 'date')),
  label      text not null,
  tag        text not null check (tag in ('D', 'R', 'A', 'S')),
  basis      text not null,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'seed'
);

insert into app.assumptions (key, value, kind, label, tag, basis) values
  ('pacing_start_date', '2025-01-20', 'date', 'Pacing starts', 'A',
   'First day of campaign activity in the data'),
  ('registration_close_date', '2025-04-10', 'date', 'Registration closes', 'A',
   'The data has no planned close date; set to the day of the last registration'),
  ('show_rate_benchmark', '0.70', 'number', 'Show-rate benchmark for confirmed registrants', 'A',
   'Placeholder until the free-event benchmark source has been read and checked'),
  ('walk_ins_benchmark', '0', 'number', 'Walk-ins expected (benchmark preset)', 'A',
   'No outside benchmark for walk-ins, so the benchmark preset leaves them out'),
  ('pace_on_track', '0.95', 'number', 'On track at or above this share of straight-line pace', 'A',
   'App PRD default'),
  ('pace_at_risk', '0.85', 'number', 'At risk at or above this share of straight-line pace', 'A',
   'App PRD default'),
  ('flag_band', '0.25', 'number', 'Scale or stop band around the benchmark', 'A',
   'Slides PRD decision rule'),
  ('flag_min_days', '14', 'number', 'Days of activity before a campaign can be flagged', 'A',
   'Slides PRD decision rule'),
  ('flag_min_confirmed', '50', 'number', 'Confirmed registrations before a campaign can be flagged', 'A',
   'Slides PRD decision rule'),
  ('small_sample_min', '30', 'number', 'Smallest denominator shown without a warning', 'A',
   'Data Foundation PRD'),
  ('simulator_bend', '0.7', 'number', 'Diminishing-returns bend for the budget simulator', 'A',
   'Common modelling choice; shown as a 0.5 to 0.9 range')
on conflict (key) do nothing;

create table if not exists app.edit_log (
  edit_id    bigserial primary key,
  at         timestamptz not null default now(),
  actor      text not null,
  action     text not null check (action in ('load', 'insert', 'update', 'delete', 'reset', 'undo')),
  table_name text,
  record_id  text,
  before     jsonb,
  after      jsonb,
  note       text,
  undone_by  bigint references app.edit_log (edit_id)
);

-- People who own campaigns and tasks. Seeded from the campaign owners on load.
create table if not exists app.team (
  owner_id text primary key,
  name     text not null,
  role     text not null default 'Campaign owner'
);

create table if not exists app.tasks (
  task_id         bigserial primary key,
  title           text not null check (length(title) between 1 and 200),
  description     text,
  campaign_id     text,                -- a working.campaigns ID, or null for cross-campaign work
  owner_id        text references app.team (owner_id),
  due_date        date,
  status          text not null default 'to do' check (status in ('to do', 'in progress', 'blocked', 'done')),
  priority        text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  source          text not null default 'manual' check (source in ('manual', 'flag', 'chatbot', 'seed')),
  metric_snapshot jsonb,               -- the metric and value that prompted the task, for the impact check
  outcome_note    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Defaults let a reset put changed assumptions back. On a database made before
-- these columns existed, the current values are still the seeded ones.
alter table app.assumptions add column if not exists default_value text;
alter table app.assumptions add column if not exists default_tag text;
alter table app.assumptions add column if not exists default_basis text;
update app.assumptions set default_value = value, default_tag = tag, default_basis = basis
where default_value is null;

-- Tasks can also come from a saved budget plan.
alter table app.tasks drop constraint if exists tasks_source_check;
alter table app.tasks add constraint tasks_source_check
  check (source in ('manual', 'flag', 'chatbot', 'seed', 'plan'));

-- The saved budget plan: one planned amount per campaign. Not in the dataset,
-- so it is labelled simulated wherever it is shown.
create table if not exists app.planned_budgets (
  campaign_id text primary key,
  planned_inr integer not null check (planned_inr >= 0),
  set_at      timestamptz not null default now(),
  set_by      text not null,
  as_of       date not null              -- the selected date the plan was made on
);
