/** Indian digit grouping, rupees, and dates as "15 Mar 2025". */

export const int = (n: number | null | undefined): string =>
  n == null ? "–" : Math.round(n).toLocaleString("en-IN");

export const inr = (n: number | null | undefined): string =>
  n == null ? "–" : `₹${Math.round(n).toLocaleString("en-IN")}`;

export const pct = (x: number | null | undefined, digits = 1): string =>
  x == null ? "–" : `${(x * 100).toFixed(digits)}%`;

export const dec = (x: number | null | undefined, digits = 1): string =>
  x == null ? "–" : x.toFixed(digits);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const day = (iso: string | null | undefined): string => {
  if (!iso) return "–";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

export const withAsOf = (href: string, asOf: string) => `${href}?asOf=${asOf}`;

/** "12–13 Apr 2025" for a range within one month, else "30 Mar–2 Apr 2025". */
export const dayRange = (from: string, to: string): string => {
  const [a, b] = [day(from), day(to)];
  if (from.slice(0, 7) === to.slice(0, 7)) return `${a.split(" ")[0]}–${b}`;
  return `${a.replace(/ \d{4}$/, "")}–${b}`;
};

/** Formats a value that may be an ISO date. */
export const maybeDay = (v: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? day(v) : v);
