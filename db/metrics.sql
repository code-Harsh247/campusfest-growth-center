-- The metric layer. Every number the app and the copilot show comes from these
-- functions, which read the `working` schema at a selected date (`as_of`).
--
-- Rules (Data Foundation PRD):
--   * A selected date means the end of that day, India time. Timestamps are
--     stored as India wall-clock values, so "known by the end of as_of" is
--     `ts < as_of + 1 day`.
--   * Only external people count toward targets.
--   * Attendee = distinct external person with an admitted AND verified check-in.
--   * Registration status = latest history version at the cutoff (ties: higher history_id).
--   * Credit: registration's campaign; else the person's first campaign; else Unattributed (null).
--   * Spend = net posted spend, credits included, by activity_date.

create schema if not exists metrics;

-- ---------------------------------------------------------------- helpers

create or replace function metrics.cutoff(as_of date) returns timestamp
language sql immutable as $$ select (as_of + 1)::timestamp $$;

create or replace function metrics.anum(p_key text) returns float8
language sql stable as $$ select value::float8 from app.assumptions where key = p_key $$;

create or replace function metrics.adate(p_key text) returns date
language sql stable as $$ select value::date from app.assumptions where key = p_key $$;

-- ---------------------------------------------------------------- building blocks

-- External people identified by the cutoff.
create or replace function metrics.ext_people(as_of date)
returns table (person_id text, first_touch_source text, first_campaign_id text, first_seen_at timestamp)
language sql stable as $$
  select p.person_id, p.first_touch_source, p.first_campaign_id, p.first_seen_at
  from working.people p
  where p.person_type = 'external' and p.first_seen_at < metrics.cutoff(as_of)
$$;

-- External registrations created by the cutoff, with their status at the cutoff.
create or replace function metrics.reg_state(as_of date)
returns table (registration_id text, person_id text, campaign_id text, registered_at timestamp, status text)
language sql stable as $$
  with latest as (
    select distinct on (h.registration_id) h.registration_id, h.status
    from working.registration_history h
    where h.effective_at < metrics.cutoff(as_of)
    order by h.registration_id, h.effective_at desc, h.history_id desc
  )
  select r.registration_id, r.person_id, r.campaign_id, r.registered_at,
         coalesce(l.status, 'interested')
  from working.registrations r
  join working.people p on p.person_id = r.person_id and p.person_type = 'external'
  left join latest l on l.registration_id = r.registration_id
  where r.registered_at < metrics.cutoff(as_of)
$$;

-- One row per external person per day with a verified admission.
create or replace function metrics.admissions(as_of date)
returns table (person_id text, day date)
language sql stable as $$
  select distinct c.person_id, c.occurred_at::date
  from working.checkins c
  join working.people p on p.person_id = c.person_id and p.person_type = 'external'
  where c.result = 'admitted' and c.verification = 'verified'
    and c.occurred_at < metrics.cutoff(as_of)
$$;

-- Which campaign gets credit for each external person, at the cutoff.
create or replace function metrics.person_credit(as_of date)
returns table (person_id text, campaign_id text, registered boolean)
language sql stable as $$
  with r as (
    select distinct on (rs.person_id) rs.person_id, rs.campaign_id
    from metrics.reg_state(as_of) rs
    order by rs.person_id, rs.registered_at, rs.registration_id
  )
  select p.person_id, coalesce(r.campaign_id, p.first_campaign_id), r.person_id is not null
  from working.people p
  left join r on r.person_id = p.person_id
  where p.person_type = 'external'
$$;

-- ---------------------------------------------------------------- campaign view

create or replace function metrics.campaign_table(as_of date)
returns table (
  campaign_id text, campaign_name text, owner_id text, owner_name text, channel text,
  spend float8, impressions int, clicks int, sessions int, form_starts int, reported_reach int,
  first_activity date, active_days int,
  identified int, registered int, confirmed int, cancelled int, waitlisted int, interested int,
  attendees int, registered_attendees int,
  registration_rate float8, confirmation_rate float8, show_rate float8, attendance_yield float8,
  ctr float8, form_start_rate float8,
  cost_per_identified float8, cost_per_registration float8, cost_per_confirmed float8,
  cost_per_attendee float8, attendees_per_1000 float8
)
language sql stable as $$
  with pc as (select * from metrics.person_credit(as_of)),
  pm as (
    select d.campaign_id,
           sum(d.marketing_spend_inr)::float8 as spend,
           sum(d.impressions)::int as impressions, sum(d.clicks)::int as clicks,
           sum(d.landing_page_sessions)::int as sessions, sum(d.registration_starts)::int as form_starts,
           sum(d.reported_reach)::int as reach, min(d.activity_date) as first_activity
    from working.daily_marketing d
    where d.activity_date <= as_of
    group by d.campaign_id
  ),
  idn as (
    select pc.campaign_id, count(*)::int as identified
    from metrics.ext_people(as_of) e join pc using (person_id)
    group by pc.campaign_id
  ),
  rs as (
    select r.campaign_id,
           count(distinct r.person_id)::int as registered,
           count(*) filter (where r.status = 'confirmed')::int as confirmed,
           count(*) filter (where r.status = 'cancelled')::int as cancelled,
           count(*) filter (where r.status = 'waitlisted')::int as waitlisted,
           count(*) filter (where r.status = 'interested')::int as interested
    from metrics.reg_state(as_of) r
    group by r.campaign_id
  ),
  att as (
    select pc.campaign_id,
           count(distinct a.person_id)::int as attendees,
           count(distinct a.person_id) filter (where pc.registered)::int as registered_attendees
    from metrics.admissions(as_of) a join pc using (person_id)
    group by pc.campaign_id
  ),
  keys as (
    select c.campaign_id from working.campaigns c where c.created_at < metrics.cutoff(as_of)
    union select campaign_id from pm
    union select campaign_id from idn
    union select campaign_id from rs
    union select campaign_id from att
  ),
  base as (
    select k.campaign_id,
           coalesce(c.campaign_name, case when k.campaign_id is null then 'Unattributed' else k.campaign_id end) as campaign_name,
           c.owner_id, c.owner_name, c.channel,
           pm.spend, coalesce(pm.impressions, 0) as impressions, coalesce(pm.clicks, 0) as clicks,
           coalesce(pm.sessions, 0) as sessions, coalesce(pm.form_starts, 0) as form_starts,
           coalesce(pm.reach, 0) as reach, pm.first_activity,
           coalesce(idn.identified, 0) as identified,
           coalesce(rs.registered, 0) as registered, coalesce(rs.confirmed, 0) as confirmed,
           coalesce(rs.cancelled, 0) as cancelled, coalesce(rs.waitlisted, 0) as waitlisted,
           coalesce(rs.interested, 0) as interested,
           coalesce(att.attendees, 0) as attendees,
           coalesce(att.registered_attendees, 0) as registered_attendees
    from keys k
    left join working.campaigns c on c.campaign_id = k.campaign_id
    left join pm on pm.campaign_id is not distinct from k.campaign_id
    left join idn on idn.campaign_id is not distinct from k.campaign_id
    left join rs on rs.campaign_id is not distinct from k.campaign_id
    left join att on att.campaign_id is not distinct from k.campaign_id
  )
  select campaign_id, campaign_name, owner_id, owner_name, channel,
         spend, impressions, clicks, sessions, form_starts, reach,
         first_activity, case when first_activity is null then 0 else (as_of - first_activity + 1) end,
         identified, registered, confirmed, cancelled, waitlisted, interested,
         attendees, registered_attendees,
         registered::float8 / nullif(identified, 0),
         confirmed::float8 / nullif(registered, 0),
         registered_attendees::float8 / nullif(confirmed, 0),
         registered_attendees::float8 / nullif(registered, 0),
         clicks::float8 / nullif(impressions, 0),
         form_starts::float8 / nullif(sessions, 0),
         spend / nullif(identified, 0),
         spend / nullif(registered, 0),
         spend / nullif(confirmed, 0),
         spend / nullif(attendees, 0),
         attendees * 1000.0 / nullif(spend, 0)
  from base
  order by campaign_id nulls last
$$;

-- ---------------------------------------------------------------- totals

create or replace function metrics.funnel(as_of date, p_campaign_id text default null)
returns table (
  identified int, identified_via_campaigns int,
  registered int, confirmed int, cancelled int, waitlisted int, interested int,
  attendees int, registered_attendees int, walk_in_attendees int, visitor_days int,
  impressions int, clicks int, sessions int, form_starts int, spend float8
)
language sql stable as $$
  with pc as (
    select * from metrics.person_credit(as_of)
  ),
  ep as (
    select e.person_id, pc.campaign_id
    from metrics.ext_people(as_of) e join pc using (person_id)
    where p_campaign_id is null or pc.campaign_id = p_campaign_id
  ),
  rs as (
    select * from metrics.reg_state(as_of) r
    where p_campaign_id is null or r.campaign_id = p_campaign_id
  ),
  ad as (
    select a.person_id, a.day, pc.registered
    from metrics.admissions(as_of) a join pc using (person_id)
    where p_campaign_id is null or pc.campaign_id = p_campaign_id
  ),
  dm as (
    select * from working.daily_marketing d
    where d.activity_date <= as_of and (p_campaign_id is null or d.campaign_id = p_campaign_id)
  )
  select
    (select count(*)::int from ep),
    (select count(*)::int from ep where campaign_id is not null),
    (select count(distinct person_id)::int from rs),
    (select count(*) filter (where status = 'confirmed')::int from rs),
    (select count(*) filter (where status = 'cancelled')::int from rs),
    (select count(*) filter (where status = 'waitlisted')::int from rs),
    (select count(*) filter (where status = 'interested')::int from rs),
    (select count(distinct person_id)::int from ad),
    (select count(distinct person_id)::int from ad where registered),
    (select count(distinct person_id)::int from ad where not registered),
    (select count(*)::int from ad),
    (select coalesce(sum(impressions), 0)::int from dm),
    (select coalesce(sum(clicks), 0)::int from dm),
    (select coalesce(sum(landing_page_sessions), 0)::int from dm),
    (select coalesce(sum(registration_starts), 0)::int from dm),
    (select coalesce(sum(marketing_spend_inr), 0)::float8 from dm)
$$;

-- ---------------------------------------------------------------- targets

create or replace function metrics.targets_in_force(as_of date)
returns table (
  target_version text, effective_at timestamp,
  identified_external_people_goal int, registration_goal int,
  unique_external_visitors_goal int, marketing_budget_inr int
)
language sql stable as $$
  select t.target_version, t.effective_at, t.identified_external_people_goal, t.registration_goal,
         t.unique_external_visitors_goal, t.marketing_budget_inr
  from working.targets t
  where t.effective_at < metrics.cutoff(as_of)
  order by t.effective_at desc
  limit 1
$$;

-- Actual against the target in force, with a straight-line pace (an assumption).
create or replace function metrics.target_status(as_of date)
returns table (
  target text, actual float8, goal float8, attainment float8,
  expected_to_date float8, status text, target_version text
)
language sql stable as $$
  with t as (select * from metrics.targets_in_force(as_of)),
  f as (select * from metrics.funnel(as_of)),
  d as (
    select metrics.adate('pacing_start_date') as s,
           metrics.adate('registration_close_date') as c,
           (select e.event_ends_at::date from working.event e limit 1) as ev
  ),
  sh as (
    select least(greatest((as_of - d.s + 1)::float8 / nullif(d.c - d.s + 1, 0), 0), 1) as reg_share,
           least(greatest((as_of - d.s + 1)::float8 / nullif(d.ev - d.s + 1, 0), 0), 1) as ev_share,
           as_of >= d.ev as post_event,
           as_of > d.c as after_close
    from d
  ),
  -- `final`: the deadline has passed, so the verdict is met or missed, not a pace.
  -- People can still be identified at the event (walk-ins); registrations stop at close.
  r as (
    select 1 as ord, 'identified_people' as target, f.identified::float8 as actual,
           t.identified_external_people_goal::float8 as goal, sh.reg_share as share,
           sh.post_event as final, t.target_version
    from t, f, sh
    union all
    select 2, 'registrations', f.registered, t.registration_goal, sh.reg_share, sh.after_close, t.target_version
    from t, f, sh
    union all
    select 3, 'verified_attendees', f.attendees, t.unique_external_visitors_goal, null, sh.post_event, t.target_version
    from t, f, sh
    union all
    select 4, 'marketing_budget', f.spend, t.marketing_budget_inr, sh.ev_share, false, t.target_version
    from t, f, sh
  )
  select r.target, r.actual, r.goal, r.actual / nullif(r.goal, 0),
         case when r.final then null else r.goal * r.share end,
         case
           when r.target = 'marketing_budget' then
             case when r.actual > r.goal then 'over budget' else 'within budget' end
           when r.final then
             case when r.actual >= r.goal then 'met' else 'missed' end
           when r.target = 'verified_attendees' then null
           when r.actual >= metrics.anum('pace_on_track') * r.goal * r.share then 'on track'
           when r.actual >= metrics.anum('pace_at_risk') * r.goal * r.share then 'at risk'
           else 'behind'
         end,
         r.target_version
  from r
  order by r.ord
$$;

-- ---------------------------------------------------------------- flags

-- One read: expected attendees per Rs 1,000 for each campaign, against the
-- median campaign. Before the event ends, expected attendees are confirmed
-- registrations times the show-rate benchmark (an assumption); after it,
-- actual verified attendees.
create or replace function metrics.flag_reads(as_of date)
returns table (
  campaign_id text, campaign_name text, owner_name text, spend float8, confirmed int, attendees int,
  basis text, expected_attendees float8, per_1000 float8, eligible boolean,
  benchmark float8, ratio float8
)
language sql stable as $$
  with ev as (select e.event_ends_at::date as d from working.event e limit 1),
  ct as (
    select c.*,
           (as_of >= (select d from ev)) as post
    from metrics.campaign_table(as_of) c
    where c.campaign_id is not null
  ),
  x as (
    select ct.campaign_id, ct.campaign_name, ct.owner_name, ct.spend, ct.confirmed, ct.attendees,
           case when ct.post then 'actual attendees' else 'confirmed x show-rate benchmark' end as basis,
           case when ct.post then ct.attendees::float8
                else ct.confirmed * metrics.anum('show_rate_benchmark') end as expected_attendees,
           coalesce(ct.spend, 0) > 0
             and (ct.active_days >= metrics.anum('flag_min_days')
                  or ct.confirmed >= metrics.anum('flag_min_confirmed')) as eligible
    from ct
  ),
  y as (
    select x.*, x.expected_attendees * 1000.0 / nullif(x.spend, 0) as per_1000 from x
  ),
  m as (
    select percentile_cont(0.5) within group (order by y.per_1000) as med
    from y where y.eligible and y.per_1000 is not null
  )
  select y.campaign_id, y.campaign_name, y.owner_name, y.spend, y.confirmed, y.attendees,
         y.basis, y.expected_attendees, y.per_1000, y.eligible,
         m.med, y.per_1000 / nullif(m.med, 0)
  from y, m
  order by y.campaign_id
$$;

-- Scale at 25% or more above the median, stop at more than 25% below for two
-- weekly reads in a row, change otherwise (Slides PRD rule).
create or replace function metrics.flags(as_of date)
returns table (
  campaign_id text, campaign_name text, owner_name text, spend float8, basis text,
  expected_attendees float8, per_1000 float8, benchmark float8, ratio float8,
  previous_ratio float8, flag text
)
language sql stable as $$
  with cur as (select * from metrics.flag_reads(as_of)),
  prev as (select * from metrics.flag_reads(as_of - 7)),
  band as (select metrics.anum('flag_band') as b)
  select cur.campaign_id, cur.campaign_name, cur.owner_name, cur.spend, cur.basis,
         cur.expected_attendees, cur.per_1000, cur.benchmark, cur.ratio, prev.ratio,
         case
           when not cur.eligible or cur.ratio is null then 'insufficient data'
           when cur.ratio >= 1 + band.b then 'scale'
           when cur.ratio < 1 - band.b and coalesce(prev.eligible, false) and prev.ratio < 1 - band.b then 'stop'
           else 'change'
         end
  from cur
  cross join band
  left join prev on prev.campaign_id = cur.campaign_id
  order by cur.campaign_id
$$;

-- ---------------------------------------------------------------- trends

-- Weekly totals by campaign (weeks start on Monday), up to the cutoff.
create or replace function metrics.weekly(as_of date)
returns table (
  week_start date, campaign_id text, identified int, registrations int,
  spend float8, impressions int, clicks int, sessions int, form_starts int
)
language sql stable as $$
  with pc as (select * from metrics.person_credit(as_of)),
  parts as (
    select date_trunc('week', e.first_seen_at)::date as wk, pc.campaign_id,
           1 as identified, 0 as registrations, 0::float8 as spend, 0 as impressions, 0 as clicks, 0 as sessions, 0 as form_starts
    from metrics.ext_people(as_of) e join pc using (person_id)
    union all
    select date_trunc('week', r.registered_at)::date, r.campaign_id, 0, 1, 0, 0, 0, 0, 0
    from metrics.reg_state(as_of) r
    union all
    select date_trunc('week', d.activity_date)::date, d.campaign_id, 0, 0,
           d.marketing_spend_inr, d.impressions, d.clicks, d.landing_page_sessions, d.registration_starts
    from working.daily_marketing d
    where d.activity_date <= as_of
  )
  select wk, campaign_id, sum(identified)::int, sum(registrations)::int, sum(spend)::float8,
         sum(impressions)::int, sum(clicks)::int, sum(sessions)::int, sum(form_starts)::int
  from parts
  group by wk, campaign_id
  order by wk, campaign_id nulls last
$$;

-- ---------------------------------------------------------------- projection

-- Low, middle and high outcomes. Registrations: current count plus the 7, 14
-- and 28-day run rates times the days left to registration close. Attendees:
-- per campaign, (confirmed + w x still-interested + r x new registrations) x
-- show rate, plus walk-ins, where w and r are the campaign's confirmation share
-- so far. Presets: 'benchmark' (show rate and walk-ins are assumptions) or
-- 'campusfest2025' (this dataset's final rates: post-event knowledge in a replay).
-- After the event ends, returns actuals.
create or replace function metrics.projection(as_of date, preset text default 'benchmark')
returns table (
  scenario text, window_days int, registrations float8, attendees float8,
  mode text, uses_post_event_knowledge boolean
)
language sql stable as $$
  with ev as (
    select e.event_ends_at::date as ends, e.history_end as hist_end from working.event e limit 1
  ),
  post as (select as_of >= ev.ends as is_post from ev),
  left_days as (select greatest(metrics.adate('registration_close_date') - as_of, 0) as n),
  rs as (select * from metrics.reg_state(as_of)),
  cur as (
    select r.campaign_id,
           count(distinct r.person_id)::float8 as reg,
           count(*) filter (where r.status = 'confirmed')::float8 as conf,
           count(*) filter (where r.status = 'interested')::float8 as intr
    from rs r
    group by r.campaign_id
  ),
  win as (select w from (values (7), (14), (28)) v(w)),
  rates as (
    select win.w, cur.campaign_id,
           (select count(*)::float8
              from rs r
              where r.campaign_id is not distinct from cur.campaign_id
                and r.registered_at >= metrics.cutoff(as_of) - make_interval(days => win.w)) / win.w as per_day
    from win cross join cur
  ),
  final_show as (
    select c.campaign_id, c.show_rate
    from metrics.campaign_table((select hist_end from ev)) c
  ),
  per_campaign as (
    select rates.w, cur.campaign_id,
           cur.reg + rates.per_day * (select n from left_days) as reg_proj,
           (cur.conf
              + (cur.conf / nullif(cur.reg, 0)) * cur.intr
              + (cur.conf / nullif(cur.reg, 0)) * rates.per_day * (select n from left_days))
           * case when preset = 'campusfest2025'
                  then coalesce((select fs.show_rate from final_show fs
                                 where fs.campaign_id is not distinct from cur.campaign_id), 0)
                  else metrics.anum('show_rate_benchmark') end as att_proj
    from rates join cur on cur.campaign_id is not distinct from rates.campaign_id
  ),
  walk_ins as (
    select case when preset = 'campusfest2025'
                then (select f.walk_in_attendees::float8 from metrics.funnel((select hist_end from ev)) f)
                else metrics.anum('walk_ins_benchmark') end as expected_walk_ins
  ),
  ranked as (
    select pcm.w, sum(pcm.reg_proj) as regs,
           sum(coalesce(pcm.att_proj, 0)) + (select wi.expected_walk_ins from walk_ins wi) as att
    from per_campaign pcm group by pcm.w
  ),
  scen as (
    -- low and high are the smallest and largest of the three windows, not tied to one window.
    select 'low' as scenario, null::int as window_days, min(regs) as regs, min(att) as att from ranked
    union all
    select 'middle', 14, regs, att from ranked where w = 14
    union all
    select 'high', null, max(regs), max(att) from ranked
  )
  select s.scenario, s.window_days, s.regs, s.att, 'projection',
         preset = 'campusfest2025'
  from scen s, post where not post.is_post
  union all
  select v.scenario, null, f.registered::float8, f.attendees::float8, 'actual', false
  from metrics.funnel(as_of) f, post,
       (values ('low'), ('middle'), ('high')) v(scenario)
  where post.is_post
$$;

-- ---------------------------------------------------------------- data quality

create or replace function metrics.data_quality()
returns table (check_name text, table_name text, row_count int, detail text)
language sql stable as $$
  select 'Import repeats removed', l.table_name, l.repeated_rows,
         'Identical rows sharing a stable ID; counted once'
  from app.load_report l where l.repeated_rows > 0
  union all
  select 'Conflicting repeated IDs', l.table_name, l.conflicting_ids,
         'Same ID with different content; the first copy was kept'
  from app.load_report l where l.conflicting_ids > 0
  union all
  select 'Vendor credits (negative spend)', 'daily_marketing', count(*)::int,
         'Kept: net spend includes credits'
  from working.daily_marketing where marketing_spend_inr < 0
  union all
  select 'Spend posted after the event', 'daily_marketing', count(*)::int,
         'Kept: lowers final spend after the event days'
  from working.daily_marketing
  where activity_date > (select e.event_ends_at::date from working.event e limit 1)
  union all
  select 'More sessions than clicks', 'daily_marketing', count(*)::int,
         'Anonymous counts, accepted as reported'
  from working.daily_marketing where landing_page_sessions > clicks
  union all
  select 'Registrations by non-external people', 'registrations', count(*)::int,
         'Excluded from every target and metric'
  from working.registrations r join working.people p using (person_id)
  where p.person_type <> 'external'
  union all
  select 'Check-ins not admitted and verified', 'checkins', count(*)::int,
         'Denied, pending or unverified records do not count as attendance'
  from working.checkins where not (result = 'admitted' and verification = 'verified')
  union all
  select 'Registrations pointing to a missing person', 'registrations', count(*)::int, 'Cannot be counted'
  from working.registrations r where not exists (select 1 from working.people p where p.person_id = r.person_id)
  union all
  select 'Status versions pointing to a missing registration', 'registration_history', count(*)::int, 'Ignored'
  from working.registration_history h
  where not exists (select 1 from working.registrations r where r.registration_id = h.registration_id)
  union all
  select 'Check-ins pointing to a missing person', 'checkins', count(*)::int, 'Cannot be counted'
  from working.checkins c where not exists (select 1 from working.people p where p.person_id = c.person_id)
  union all
  select 'Spend rows for a campaign not in the campaign list', 'daily_marketing', count(*)::int,
         'Shown under the campaign ID'
  from working.daily_marketing d
  where not exists (select 1 from working.campaigns c where c.campaign_id = d.campaign_id)
$$;
