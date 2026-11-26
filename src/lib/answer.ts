/**
 * The copilot answers in a fixed plain-text shape (see the briefing). This turns
 * it into the parts the answer card shows. Pure code, used while text streams,
 * so a half-written answer must parse too.
 */

export interface ParsedAnswer {
  kind: "answer" | "cannot" | "plain";
  headline: string;
  bullets: string[];
  measured: string | null;
  judgement: string | null;
  closest: string | null;
  needed: string | null;
  next: string | null;
  other: string[];
}

const PREFIX: [RegExp, keyof ParsedAnswer][] = [
  [/^measured:\s*/i, "measured"],
  [/^judge?ment:\s*/i, "judgement"],
  [/^closest fact:\s*/i, "closest"],
  [/^needed:\s*/i, "needed"],
  [/^next:\s*/i, "next"],
];

export function parseAnswer(text: string): ParsedAnswer {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const out: ParsedAnswer = { kind: "plain", headline: "", bullets: [], measured: null, judgement: null, closest: null, needed: null, next: null, other: [] };
  for (const raw of lines) {
    const line = raw.replace(/\*\*/g, "");
    const cannot = line.match(/^can'?t answer:\s*/i) ?? line.match(/^cannot answer:\s*/i);
    if (!out.headline && cannot) { out.kind = "cannot"; out.headline = line.slice(cannot[0].length); continue; }
    const field = PREFIX.find(([re]) => re.test(line));
    if (field) {
      (out[field[1]] as string | null) = line.replace(field[0], "");
      if (out.kind === "plain") out.kind = "answer";
      continue;
    }
    if (/^[-•*]\s+/.test(line)) { out.bullets.push(line.replace(/^[-•*]\s+/, "")); if (out.kind === "plain" && out.headline) out.kind = "answer"; continue; }
    if (!out.headline) { out.headline = line; continue; }
    out.other.push(line);
  }
  return out;
}

/** Whether the next step offers a task, so the card can show a Draft task button. */
export const offersTask = (next: string | null) => !!next && /\b(draft|create|add|set up|open)\b[^.?]*\btask\b/i.test(next) && /\?\s*$/.test(next);
