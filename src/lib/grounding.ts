/**
 * The grounding check from the copilot PRD: every number in an answer must
 * appear, after rounding, in a tool result from the same turn. A number from
 * nowhere fails even when it happens to be right.
 */

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";

/** Numbers as written in the answer, with dates, years and small counts left out. */
export function numbersIn(answer: string): { text: string; value: number; decimals: number; percent: boolean }[] {
  const cleaned = answer
    // "12 and 13 Apr", "24 Mar to 30 Mar": the first day of a range written out in words
    .replace(new RegExp(`\\b\\d{1,2}(?:\\s+(?:${MONTHS})[a-z]*)?\\s+(?:and|to|&)\\s+(?=\\d{1,2}\\s+(?:${MONTHS}))`, "gi"), " ")
    // settings named by length, such as "28-day run rate" or "a 14-day window"
    .replace(/\b\d+-(?:day|week|month)s?\b/gi, " ")
    .replace(new RegExp(`\\b\\d{1,2}\\s*(?:[–-]\\s*\\d{1,2}\\s*)?(?:${MONTHS})[a-z]*\\.?(?:\\s+\\d{4})?`, "gi"), " ") // 20 Apr 2025, 24–30 Mar
    .replace(new RegExp(`\\b(?:${MONTHS})[a-z]*\\.?\\s+\\d{1,2}(?:,?\\s+\\d{4})?`, "gi"), " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\b[A-Z]{1,4}-?\d{1,4}\b/g, " ") // IDs such as C02, AD-C06
    .replace(/#\d+/g, " ");
  const found: { text: string; value: number; decimals: number; percent: boolean }[] = [];
  for (const m of cleaned.matchAll(/[−-]?\d[\d,]*(?:\.\d+)?\s*%?/g)) {
    const text = m[0].trim();
    const percent = text.endsWith("%");
    const digits = text.replace(/[%,\s]/g, "").replace("−", "-");
    const value = Number(digits);
    if (!Number.isFinite(value)) continue;
    const decimals = digits.includes(".") ? digits.split(".")[1].length : 0;
    if (!percent && decimals === 0 && Math.abs(value) <= 10) continue; // "two weekly reads", "7 days", "1 of 3"
    found.push({ text, value: Math.abs(value), decimals, percent });
  }
  return found;
}

/** Every number in a set of tool results (JSON), at any depth, including numbers written inside strings. */
export function numbersFrom(results: string[]): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number") out.push(Math.abs(v));
    else if (typeof v === "string") for (const m of v.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.push(Number(m[0].replace(/,/g, "")));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const r of results) {
    try { walk(JSON.parse(r)); } catch { walk(r); }
  }
  return out;
}

const roundTo = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** The answer's numbers that no tool result explains. Empty means grounded. */
export function ungroundedNumbers(answer: string, results: string[]): string[] {
  const pool = numbersFrom(results);
  const misses: string[] = [];
  for (const n of numbersIn(answer)) {
    const ok = pool.some((v) => {
      const candidates = n.percent ? [v * 100, v] : [v, v * 100];
      return candidates.some((c) => roundTo(c, n.decimals) === n.value || (n.decimals === 0 && Math.abs(c - n.value) < 0.5 + 1e-9));
    });
    if (!ok) misses.push(n.text);
  }
  return misses;
}
