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
