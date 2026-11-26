import type { DataWindow } from "@/foundation";

/**
 * Reads the date picker's value from the URL. A missing value means the last
 * day of the data; an invalid one falls back to it with a visible notice,
 * rather than silently showing another date.
 */
export function resolveAsOf(raw: string | string[] | undefined, w: DataWindow): { asOf: string; notice?: string } {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return { asOf: w.end };
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
  if (!ok) return { asOf: w.end, notice: `"${value}" is not a date; showing ${w.end}.` };
  if (value < w.start || value > w.end) {
    return { asOf: w.end, notice: `The data covers ${w.start} to ${w.end}; ${value} is outside it, so showing ${w.end}.` };
  }
  return { asOf: value };
}
