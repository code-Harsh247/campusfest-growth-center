import { createHash } from "node:crypto";

/**
 * Keeps a public link from running up an unbounded bill: 20 questions an hour
 * per visitor and a cap across all visitors. In memory, so a restart resets it;
 * the hard monthly cap belongs on the API key itself.
 */

const PER_VISITOR = Number(process.env.COPILOT_PER_VISITOR_HOURLY || 20);
const ALL_VISITORS = Number(process.env.COPILOT_HOURLY_LIMIT || 150);
const HOUR = 3600_000;

const byVisitor = new Map<string, number[]>();
let everyone: number[] = [];

/** A short hash of the visitor's address; the address itself is never stored. */
export function visitorId(headers: Headers): string {
  const ip = headers.get("x-forwarded-for")?.split(",")[0].trim() || headers.get("x-real-ip") || "local";
  return createHash("sha256").update(`growth-center:${ip}`).digest("hex").slice(0, 16);
}

/** Records a question if allowed; otherwise says how many seconds until the next one is. */
export function take(visitor: string, now = Date.now()): { ok: true } | { ok: false; retryAfter: number } {
  const mine = (byVisitor.get(visitor) ?? []).filter((t) => now - t < HOUR);
  everyone = everyone.filter((t) => now - t < HOUR);
  if (mine.length >= PER_VISITOR) return { ok: false, retryAfter: Math.ceil((mine[0] + HOUR - now) / 1000) };
  if (everyone.length >= ALL_VISITORS) return { ok: false, retryAfter: Math.ceil((everyone[0] + HOUR - now) / 1000) };
  mine.push(now);
  everyone.push(now);
  byVisitor.set(visitor, mine);
  return { ok: true };
}
