/**
 * The 2025 evidence quoted on the strategy slides, computed from the dataset
 * through the metric functions (D). Run: npx tsx scripts/strategy-evidence.ts
 */
import { readFileSync } from "node:fs";
import { loadDataset, migrate, openPglite, parseSnapshot, type Db } from "../src/foundation";

const Q = async (db: Db, label: string, sql: string) => {
  const rows = await db.query(sql);
  console.log(`\n## ${label}`);
  for (const r of rows) console.log(JSON.stringify(r));
};

async function main() {
  const db = await openPglite();
  await migrate(db);
  await loadDataset(db, parseSnapshot(JSON.parse(readFileSync("data/attendee-dataset.json", "utf8"))));
  const D = "'2025-04-20'";

  await Q(db, "Late-window cost per attendee (spend and sign-ups from 15 Mar), by campaign", `
    with late_spend as (select campaign_id, sum(marketing_spend_inr) s from working.daily_marketing where activity_date >= '2025-03-15' group by 1),
    late_people as (select r.campaign_id, count(distinct a.person_id) n
      from metrics.reg_state(${D}) r join metrics.admissions(${D}) a using (person_id)
      where r.registered_at >= '2025-03-15' group by 1)
    select c.campaign_name, s::int as late_spend, coalesce(n,0) as late_attendees, round(s / nullif(n,0)) as late_cost_per_attendee
    from working.campaigns c left join late_spend using (campaign_id) left join late_people using (campaign_id) order by 4`);

  await Q(db, "Share of 2025 spend vs share of campaign attendees", `
    select campaign_name, round((100.0*spend/sum(spend) over ())::numeric,1) as spend_pct, round((100.0*attendees/sum(attendees) over ())::numeric,1) as attendee_pct
    from metrics.campaign_table(${D}) where campaign_id is not null order by spend desc`);

  await Q(db, "Statuses at the end (registrations)", `select status, count(*) from metrics.reg_state(${D}) group by 1 order by 2 desc`);
  await Q(db, "Did cancelled or waitlisted people attend?", `
    select r.status, count(distinct a.person_id) as attended from metrics.reg_state(${D}) r left join metrics.admissions(${D}) a using (person_id)
    where r.status in ('cancelled','waitlisted') group by 1`);

  await Q(db, "Email engagement vs attendance among confirmed registrants", `
    with conf as (select person_id from metrics.reg_state(${D}) where status = 'confirmed'),
    eng as (select distinct person_id, true as engaged from working.interactions where event_type in ('nurture_email_opened','nurture_email_clicked')),
    att as (select distinct person_id, true as came from metrics.admissions(${D}))
    select coalesce(eng.engaged,false) as opened_or_clicked, count(*) as confirmed, count(att.came) as attended, round(100.0*count(att.came)/count(*),1) as show_pct
    from conf left join eng using (person_id) left join att using (person_id) group by 1`);
  await Q(db, "Interaction event types", `select event_type, count(*) from working.interactions group by 1 order by 2 desc`);

  await Q(db, "Registrations by 15 Mar vs straight line", `
    with r as (select registered_at::date d from metrics.reg_state(${D}))
    select count(*) filter (where d <= '2025-03-15') as by_15mar, count(*) as total,
           round(100.0*count(*) filter (where d <= '2025-03-15')/count(*),1) as pct_by_15mar from r`);

  await Q(db, "Days: day one, day two, both", `
    select count(distinct person_id) filter (where day='2025-04-12') d1, count(distinct person_id) filter (where day='2025-04-13') d2,
           (select count(*) from (select person_id from metrics.admissions(${D}) group by 1 having count(*)=2) x) both_days
    from metrics.admissions(${D})`);
  await Q(db, "Busiest hour of entries, day one", `
    select date_trunc('hour', occurred_at) h, count(distinct c.person_id) n from working.checkins c join working.people p using (person_id)
    where p.person_type='external' and result='admitted' and verification='verified' and occurred_at::date='2025-04-12' group by 1 order by 2 desc limit 1`);

  await Q(db, "Paid Social click-through before and after 15 Mar", `
    select activity_date >= '2025-03-15' as late, round(100.0*sum(clicks)/sum(impressions),2) ctr
    from working.daily_marketing d join working.campaigns c using (campaign_id) where c.campaign_name='Paid Social' and activity_date <= '2025-04-12' group by 1`);

  await Q(db, "Registration rate by campaign (identified → registered)", `
    select campaign_name, identified, registered, identified - registered as never_registered, round(100.0*registered/identified,1) pct
    from metrics.campaign_table(${D}) where campaign_id is not null order by pct`);

  await Q(db, "Cost per confirmed, Paid Social", `select campaign_name, round(cost_per_confirmed::numeric) from metrics.campaign_table(${D}) where campaign_name in ('Paid Social','Creator Partners')`);
  await db.close();
}
main();
