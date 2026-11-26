import type { ColumnSpec } from "./spec";

/**
 * Converts one raw value (from a spreadsheet cell, a CSV field or an edit form)
 * into the stored form for its column. Throws a readable message on bad input.
 *
 * Stored forms: text -> string, int -> integer, bool -> boolean,
 * date -> "YYYY-MM-DD", ts -> "YYYY-MM-DD HH:MM:SS" in India wall-clock time.
 */
export function convertValue(col: ColumnSpec, raw: unknown): string | number | boolean | null {
  const v = unwrapCell(raw);
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) {
    if (col.nullable) return null;
    throw new Error(`${col.name} is required`);
  }
  switch (col.type) {
    case "text":
      return String(v).trim();
    case "int": {
      const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
      if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`${col.name} must be a whole number, got "${v}"`);
      return n;
    }
    case "bool": {
      if (typeof v === "boolean") return v;
      const s = String(v).trim().toLowerCase();
      if (s === "true" || s === "1" || s === "yes") return true;
      if (s === "false" || s === "0" || s === "no") return false;
      throw new Error(`${col.name} must be true or false, got "${v}"`);
    }
    case "date":
      return toIndiaWallClock(v, col.name).slice(0, 10);
    case "ts":
      return toIndiaWallClock(v, col.name);
  }
}

/** exceljs wraps some cells in objects (formulas, rich text, hyperlinks). */
function unwrapCell(raw: unknown): unknown {
  if (raw && typeof raw === "object" && !(raw instanceof Date)) {
    const o = raw as Record<string, unknown>;
    if ("result" in o) return unwrapCell(o.result);
    if ("richText" in o && Array.isArray(o.richText)) {
      return (o.richText as { text: string }[]).map((r) => r.text).join("");
    }
    if ("text" in o) return o.text;
  }
  return raw;
}

const pad = (n: number) => String(n).padStart(2, "0");
const IST_OFFSET_MS = 330 * 60_000;

function formatUtcParts(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/**
 * Spreadsheet dates arrive as JS Dates whose UTC fields hold the sheet's
 * wall-clock value (the sheet has no offset; the guidance says it is India
 * time). Text dates with an explicit offset are converted to India time;
 * text without an offset is taken as India time already.
 */
function toIndiaWallClock(v: unknown, name: string): string {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new Error(`${name} is not a valid date`);
    // Round to the nearest second: spreadsheet serials carry float noise.
    return formatUtcParts(new Date(Math.round(v.getTime() / 1000) * 1000));
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) throw new Error(`${name} must be a date like 2025-04-12 or 2025-04-12 10:00, got "${s}"`);
  const [, day, hh = "00", mm = "00", ss = "00", offset] = m;
  if (!offset) return `${day} ${hh}:${mm}:${ss}`;
  const instant = Date.parse(`${day}T${hh}:${mm}:${ss}${offset === "Z" ? "Z" : offset.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")}`);
  if (Number.isNaN(instant)) throw new Error(`${name} is not a valid date: "${s}"`);
  return formatUtcParts(new Date(instant + IST_OFFSET_MS));
}
