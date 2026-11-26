/**
 * One definition per source table. The database tables (original and working
 * copies) and the spreadsheet loader are both generated from this list, so
 * they cannot drift apart.
 *
 * Timestamps in the supplied data carry no offset and are India time
 * (Asia/Kolkata). They are stored as `timestamp` (no zone) holding the India
 * wall-clock value, and every date filter compares against that same clock.
 */

export type ColumnType = "text" | "int" | "bool" | "date" | "ts";

export interface ColumnSpec {
  name: string;
  type: ColumnType;
  /** True when a blank value is allowed. */
  nullable?: boolean;
}

export interface TableSpec {
  /** Table name inside the `original` and `working` schemas. */
  table: string;
  /** Sheet name in the supplied workbook. */
  sheet: string;
  /** Stable ID column; repeated IDs are import retries. */
  key: string;
  /** Column holding the moment the record became known, for time filters. */
  timeColumn?: string;
  columns: ColumnSpec[];
  /** Extra indexes on the working copy. */
  indexes?: string[][];
}

const c = (name: string, type: ColumnType, nullable = false): ColumnSpec => ({ name, type, nullable });

export const TABLES: TableSpec[] = [
  {
    table: "event",
    sheet: "Event",
    key: "event_name",
    columns: [
      c("event_name", "text"),
      c("history_start", "date"),
      c("history_end", "date"),
      c("event_starts_at", "ts"),
      c("event_ends_at", "ts"),
      c("timezone", "text"),
      c("currency", "text"),
      c("fictional", "bool"),
    ],
  },
  {
    table: "targets",
    sheet: "Targets",
    key: "effective_at",
    timeColumn: "effective_at",
    columns: [
      c("effective_at", "ts"),
      c("identified_external_people_goal", "int"),
      c("registration_goal", "int"),
      c("unique_external_visitors_goal", "int"),
      c("marketing_budget_inr", "int"),
      c("target_version", "text"),
    ],
  },
  {
    table: "campaigns",
    sheet: "Campaigns",
    key: "campaign_id",
    timeColumn: "created_at",
    columns: [
      c("campaign_id", "text"),
      c("campaign_name", "text"),
      c("channel", "text"),
      c("target_audience", "text", true),
      c("objective", "text", true),
      c("owner_id", "text", true),
      c("owner_name", "text", true),
      c("created_at", "ts"),
      c("planned_start_at", "ts", true),
      c("planned_end_at", "ts", true),
    ],
  },
  {
    table: "daily_marketing",
    sheet: "Daily Marketing",
    key: "activity_id",
    timeColumn: "activity_date",
    columns: [
      c("activity_id", "text"),
      c("campaign_id", "text"),
      c("campaign_name", "text", true),
      c("owner_id", "text", true),
      c("owner_name", "text", true),
      c("activity_date", "date"),
      c("impressions", "int"),
      c("clicks", "int"),
      c("reported_reach", "int"),
      c("landing_page_sessions", "int"),
      c("registration_starts", "int"),
      c("marketing_spend_inr", "int"),
      c("platform", "text", true),
    ],
    indexes: [["campaign_id"], ["activity_date"]],
  },
  {
    table: "people",
    sheet: "People",
    key: "person_id",
    timeColumn: "first_seen_at",
    columns: [
      c("person_id", "text"),
      c("person_name", "text", true),
      c("person_type", "text"),
      c("first_seen_at", "ts"),
      c("first_touch_source", "text"),
      c("first_campaign_id", "text", true),
      c("first_campaign_name", "text", true),
      c("owner_id", "text", true),
      c("owner_name", "text", true),
    ],
    indexes: [["person_type"], ["first_campaign_id"]],
  },
  {
    table: "interactions",
    sheet: "Interest and Engagement",
    key: "interaction_id",
    timeColumn: "occurred_at",
    columns: [
      c("interaction_id", "text"),
      c("person_id", "text"),
      c("person_name", "text", true),
      c("campaign_id", "text", true),
      c("campaign_name", "text", true),
      c("owner_id", "text", true),
      c("owner_name", "text", true),
      c("occurred_at", "ts"),
      c("event_type", "text"),
      c("detail", "text", true),
    ],
    indexes: [["person_id"], ["campaign_id"], ["event_type"]],
  },
  {
    table: "registrations",
    sheet: "Registrations",
    key: "registration_id",
    timeColumn: "registered_at",
    columns: [
      c("registration_id", "text"),
      c("person_id", "text"),
      c("person_name", "text", true),
      c("campaign_id", "text", true),
      c("campaign_name", "text", true),
      c("owner_id", "text", true),
      c("owner_name", "text", true),
      c("registered_at", "ts"),
    ],
    indexes: [["person_id"], ["campaign_id"]],
  },
  {
    table: "registration_history",
    sheet: "Registration History",
    key: "history_id",
    timeColumn: "effective_at",
    columns: [
      c("history_id", "text"),
      c("registration_id", "text"),
      c("person_id", "text"),
      c("person_name", "text", true),
      c("campaign_id", "text", true),
      c("campaign_name", "text", true),
      c("owner_id", "text", true),
      c("owner_name", "text", true),
      c("effective_at", "ts"),
      c("status", "text"),
    ],
    indexes: [["registration_id", "effective_at"]],
  },
  {
    table: "checkins",
    sheet: "Check-ins",
    key: "event_id",
    timeColumn: "occurred_at",
    columns: [
      c("event_id", "text"),
      c("person_id", "text"),
      c("person_name", "text", true),
      c("registration_id", "text", true),
      c("campaign_id", "text", true),
      c("campaign_name", "text", true),
      c("owner_id", "text", true),
      c("owner_name", "text", true),
      c("occurred_at", "ts"),
      c("result", "text"),
      c("verification", "text"),
      c("source", "text", true),
    ],
    indexes: [["person_id"], ["occurred_at"]],
  },
];

export const TABLE_BY_NAME = new Map(TABLES.map((t) => [t.table, t]));

const SQL_TYPE: Record<ColumnType, string> = {
  text: "text",
  int: "integer",
  bool: "boolean",
  date: "date",
  ts: "timestamp",
};

/** DDL for one schema's copy of every source table. */
export function sourceTablesDdl(schema: "original" | "working"): string {
  const parts: string[] = [`create schema if not exists ${schema};`];
  for (const t of TABLES) {
    const cols = t.columns.map(
      (col) => `  ${col.name} ${SQL_TYPE[col.type]}${col.nullable ? "" : " not null"}`,
    );
    cols.push(`  primary key (${t.key})`);
    parts.push(`create table if not exists ${schema}.${t.table} (\n${cols.join(",\n")}\n);`);
    if (schema === "working") {
      for (const idx of t.indexes ?? []) {
        const name = `${t.table}_${idx.join("_")}_idx`;
        parts.push(`create index if not exists ${name} on working.${t.table} (${idx.join(", ")});`);
      }
    }
  }
  return parts.join("\n");
}
