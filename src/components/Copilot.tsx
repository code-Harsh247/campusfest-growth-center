"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionItem } from "@/foundation/copilot";
import { offersTask, parseAnswer } from "@/lib/answer";
import { day } from "@/lib/format";
import { CheckIcon, SpinnerIcon } from "./icons";

// Types only from the server modules; nothing from them is bundled.
type ReceiptSummary = { asOf: string[]; filters: string[]; metrics: string[]; sources: string[]; assumptions: string[]; warnings: string[]; tools: string[] };
type CopilotEvent =
  | { type: "status"; tool: string; label: string }
  | { type: "tool_done"; tool: string; label: string; ok: boolean }
  | { type: "text"; delta: string }
  | { type: "reset_text" }
  | { type: "proposal"; item: ActionItem }
  | { type: "done"; answer: string; receipt: ReceiptSummary; ungrounded: string[]; stopReason: string | null }
  | { type: "error"; message: string; retryable: boolean };

interface Step { tool: string; label: string; ok?: boolean }
interface Card { item: ActionItem; state: "open" | "editing" | "discarding" | "saving" | "created" | "dismissed"; taskId?: number; error?: string }
interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
  question?: string;
  status?: "streaming" | "done" | "error" | "stopped" | "rate";
  steps?: Step[];
  cards?: Card[];
  receipt?: ReceiptSummary;
  error?: string;
  retryable?: boolean;
}
interface Meta { enabled: boolean; dataVersion: number; team: { owner_id: string; name: string }[]; campaigns: { campaign_id: string; campaign_name: string; owner_id: string | null }[] }

const SCREEN: Record<string, string> = { "/": "Overview", "/campaigns": "Campaigns", "/plan": "Plan", "/tasks": "Tasks", "/data": "Data" };
const STORE = "growth-center:copilot";

function suggestions(path: string, preEvent: boolean): string[] {
  if (preEvent) return ["Are we on track for registrations?", "Which campaign is dragging?", "Will we hit the attendee target?"];
  switch (path) {
    case "/campaigns": return ["Which campaign should we cut?", "Whose campaigns spent the most?"];
    case "/plan": return ["Where should the remaining budget go?", "What if Paid Social got ₹20,000 less?"];
    case "/tasks": return ["What is overdue?", "What happened to the Paid Social task?"];
    case "/data": return ["What did the loader remove?", "How many people came on both days?"];
    default: return ["Why did registrations miss?", "Which campaign should we cut?"];
  }
}

const uid = () => Math.random().toString(36).slice(2, 10);

export function Copilot({ asOf, eventEnd }: { asOf: string; eventEnd: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [restored, setRestored] = useState(false);
  const savedVersion = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const queued = useRef<{ question: string; focus?: string } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const screen = SCREEN[pathname] ?? "Growth Center";

  // Restore the open state and this browser session's conversation.
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE) ?? "null");
      if (saved?.msgs) setMsgs(saved.msgs.map((m: Msg) => (m.status === "streaming" ? { ...m, status: "stopped" } : m)));
      if (saved?.open) setOpen(true);
      savedVersion.current = saved?.dataVersion ?? null;
    } catch { /* storage may be blocked */ }
    setRestored(true);
  }, []);

  // Save only after the saved copy was read, or the first render would overwrite it.
  useEffect(() => {
    if (!restored) return;
    try { sessionStorage.setItem(STORE, JSON.stringify({ open, msgs: msgs.slice(-40), dataVersion: meta?.dataVersion ?? savedVersion.current })); } catch { /* ignore */ }
  }, [restored, open, msgs, meta?.dataVersion]);

  // Load whether chat is on; drop history from before a data reset.
  useEffect(() => {
    if (!open || meta) return;
    fetch("/api/copilot").then((r) => r.json()).then((m: Meta) => {
      // The data was reset since this conversation: its numbers no longer hold.
      if (savedVersion.current != null && savedVersion.current !== m.dataVersion) setMsgs([]);
      savedVersion.current = m.dataVersion;
      setMeta(m);
    }).catch(() => setMeta({ enabled: false, dataVersion: 0, team: [], campaigns: [] }));
  }, [open, meta]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onAsk = (e: Event) => {
      const d = (e as CustomEvent<{ question: string; focus?: string }>).detail;
      setOpen(true);
      queued.current = d;
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("copilot:open", onOpen);
    window.addEventListener("copilot:ask", onAsk);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("copilot:open", onOpen);
      window.removeEventListener("copilot:ask", onAsk);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [msgs]);

  // Countdown for the rate limit; the waiting question goes out when it ends.
  useEffect(() => {
    if (!retryAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [retryAt]);

  const patch = (id: string, f: (m: Msg) => Msg) => setMsgs((all) => all.map((m) => (m.id === id ? f(m) : m)));

  const ask = useCallback(async (question: string, focus?: string, replaceId?: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    const history = msgs
      .filter((m) => m.role === "user" || (m.status === "done" && m.text))
      .flatMap((m) => [{
        role: m.role,
        content: m.role === "assistant"
          ? m.text + (m.cards?.length ? `\n[Task cards shown: ${m.cards.map((c) => `"${c.item.title}" (${c.state === "created" ? `created as task #${c.taskId}` : c.state === "dismissed" ? "discarded" : "not yet confirmed"})`).join("; ")}]` : "")
          : m.text,
      }]);
    const userId = uid(), botId = uid();
    setMsgs((all) => [
      ...all.filter((m) => m.id !== replaceId),
      ...(replaceId ? [] : [{ id: userId, role: "user" as const, text: q }]),
      { id: botId, role: "assistant", text: "", question: q, status: "streaming", steps: [], cards: [] },
    ]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history: replaceId ? history.slice(0, -1) : history, asOf, screen: pathname, focus }),
        signal: ctrl.signal,
      });
      if (res.status === 429) {
        const j = await res.json();
        setRetryAt(Date.now() + (j.retryAfter ?? 60) * 1000);
        queued.current = { question: q, focus };
        patch(botId, (m) => ({ ...m, status: "rate" }));
        return;
      }
      if (res.status === 503) { setMeta((m) => (m ? { ...m, enabled: false } : m)); patch(botId, (m) => ({ ...m, status: "error", error: "Chat is off.", retryable: false })); return; }
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        patch(botId, (m) => ({ ...m, status: "error", error: j.error ?? "The answer didn't come through.", retryable: res.status >= 500 }));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let cut;
        while ((cut = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          if (!chunk.startsWith("data: ")) continue;
          const ev = JSON.parse(chunk.slice(6)) as CopilotEvent;
          patch(botId, (m) => apply(m, ev));
        }
      }
      patch(botId, (m) => (m.status === "streaming" ? { ...m, status: "error", error: "The connection dropped before the reply finished.", retryable: true } : m));
    } catch {
      patch(botId, (m) => ctrl.signal.aborted
        ? { ...m, status: "stopped" }
        : { ...m, status: "error", error: "The connection dropped before the reply finished. Your question is kept.", retryable: true });
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [busy, msgs, asOf, pathname]);

  // Send a question handed over by "Ask about this", or one waiting out a rate limit.
  useEffect(() => {
    if (!open || !meta?.enabled || busy || !queued.current) return;
    if (retryAt && now < retryAt) return;
    const q = queued.current;
    queued.current = null;
    setRetryAt(null);
    const waiting = msgs.find((m) => m.status === "rate");
    void ask(q.question, q.focus, waiting?.id);
  }, [open, meta, busy, retryAt, now, msgs, ask]);

  async function decide(botId: string, item: ActionItem, body: Record<string, unknown>) {
    const setCard = (f: (c: Card) => Card) => patch(botId, (m) => ({ ...m, cards: m.cards?.map((c) => (c.item.item_id === item.item_id ? f(c) : c)) }));
    setCard((c) => ({ ...c, state: "saving", error: undefined }));
    const res = await fetch(`/api/copilot/proposals/${item.item_id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setCard((c) => ({ ...c, state: body.action === "accept" ? "editing" : "open", error: j.error ?? "Could not save" })); return; }
    setCard((c) => ({ ...c, item: j.item, state: body.action === "accept" ? "created" : "dismissed", taskId: j.task?.task_id }));
    router.refresh(); // open-task counts and lists behind the panel
  }

  const preEvent = asOf < eventEnd;
  const secondsLeft = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;

  return (
    <>
      {open && (
        <aside className="cp-panel" aria-label="Copilot">
          <header className="cp-head">
            <div className="row-between" style={{ alignItems: "center" }}>
              <h2><Sparkle /> Copilot</h2>
              <div className="row-wrap" style={{ gap: 4 }}>
                {msgs.length > 0 && !busy && (
                  <button type="button" className="cp-icon-btn text" onClick={() => setMsgs([])}>New chat</button>
                )}
                <button type="button" className="cp-icon-btn" onClick={() => setOpen(false)} aria-label="Close the copilot"><CloseIcon /></button>
              </div>
            </div>
            <div className="cp-chips-static">
              <span>Answers from live app data</span>
              <span className="info">Context: {screen} · as of {day(asOf)}</span>
            </div>
          </header>

          {meta && !meta.enabled ? (
            <div className="cp-off">
              <OffIcon />
              <strong>Chat is off</strong>
              <p>No AI key is set for this app, so the copilot can&apos;t answer. Every screen, flag and number still works without it.</p>
              <textarea disabled rows={2} aria-label="Message the copilot (unavailable)" placeholder="Chat is off" />
            </div>
          ) : (
            <>
              <div className="cp-log" role="log" aria-live="polite" ref={logRef}>
                {!msgs.length && (
                  <div className="cp-empty">
                    <strong>Ask about campaigns, targets, budget or tasks.</strong>
                    <p>Every number comes from the app&apos;s data at the date on screen, with a receipt. It can draft tasks, and you confirm each one.</p>
                  </div>
                )}
                {msgs.map((m) => m.role === "user"
                  ? <div key={m.id} className="cp-user">{m.text}</div>
                  : <Answer key={m.id} m={m} meta={meta} onDraft={() => ask("Yes, draft that task.")} busy={busy}
                      onRetry={() => m.question && ask(m.question, undefined, m.id)}
                      onStop={() => abortRef.current?.abort()} secondsLeft={secondsLeft}
                      onCard={(item, body) => decide(m.id, item, body)}
                      setCardState={(item, state) => patch(m.id, (x) => ({ ...x, cards: x.cards?.map((c) => (c.item.item_id === item.item_id ? { ...c, state } : c)) }))} />)}
              </div>
              <form className="cp-compose" onSubmit={(e) => { e.preventDefault(); if (draft.trim() && !busy) { void ask(draft); setDraft(""); } }}>
                <div className="cp-suggest">
                  {suggestions(pathname, preEvent).map((s) => (
                    <button key={s} type="button" disabled={busy || !meta} onClick={() => ask(s)}>{s}</button>
                  ))}
                </div>
                <div className="cp-input">
                  <label className="grow">
                    <span className="sr-only">Message the copilot</span>
                    <textarea
                      ref={inputRef} rows={2} value={draft} maxLength={1000}
                      placeholder="Ask about campaigns, targets or budget"
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
                    />
                  </label>
                  {busy ? (
                    <button type="button" className="cp-send stop" onClick={() => abortRef.current?.abort()} aria-label="Stop the answer"><StopIcon /></button>
                  ) : (
                    <button type="submit" className="cp-send" aria-label="Send" disabled={!draft.trim() || !meta}><ArrowIcon /></button>
                  )}
                </div>
              </form>
            </>
          )}
        </aside>
      )}
    </>
  );
}

function apply(m: Msg, ev: CopilotEvent): Msg {
  switch (ev.type) {
    case "status": return { ...m, steps: [...(m.steps ?? []), { tool: ev.tool, label: ev.label }] };
    case "tool_done": {
      const steps = [...(m.steps ?? [])];
      const i = steps.findIndex((s) => s.tool === ev.tool && s.ok === undefined);
      if (i >= 0) steps[i] = { ...steps[i], ok: ev.ok };
      return { ...m, steps };
    }
    case "text": return { ...m, text: m.text + ev.delta };
    case "reset_text": return { ...m, text: "" };
    case "proposal": return { ...m, cards: [...(m.cards ?? []), { item: ev.item, state: "open" }] };
    case "done": return { ...m, text: ev.answer || m.text, status: "done", receipt: ev.receipt };
    case "error": return { ...m, status: ev.message === "Stopped." ? "stopped" : "error", error: ev.message, retryable: ev.retryable };
  }
}

// ---------------------------------------------------------------- one answer

function Answer({ m, meta, busy, onDraft, onRetry, onStop, onCard, setCardState, secondsLeft }: {
  m: Msg; meta: Meta | null; busy: boolean; secondsLeft: number;
  onDraft: () => void; onRetry: () => void; onStop: () => void;
  onCard: (item: ActionItem, body: Record<string, unknown>) => void;
  setCardState: (item: ActionItem, state: Card["state"]) => void;
}) {
  const streaming = m.status === "streaming";
  const p = parseAnswer(m.text);
  const steps = m.steps ?? [];
  const current = streaming ? steps.find((s) => s.ok === undefined) : undefined;

  if (m.status === "rate") {
    return (
      <div className="cp-note warn" role="status">
        <strong>Too many questions for now</strong>
        <p>The copilot has reached its limit. Your question will be sent when the wait ends.</p>
        <button type="button" className="btn secondary small" disabled>Retry in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}</button>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      {(streaming || steps.length > 0) && (
        <div className="cp-steps">
          {streaming && !m.text && (
            <div role="status" className="cp-now"><SpinnerIcon color="#1D4ED8" /> {current ? `${current.label}…` : "Thinking…"}</div>
          )}
          {steps.filter((s) => s.ok !== undefined).length > 0 && (
            <ul>
              {steps.filter((s) => s.ok !== undefined).map((s, i) => (
                <li key={i} className={s.ok ? "" : "bad-text"}>{s.ok ? "✓" : "✕"} {s.label}{s.ok ? "" : " (failed; retried or skipped)"}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {m.text && p.kind === "plain" && !p.bullets.length ? (
        <div className="cp-plain">
          {[p.headline, ...p.other].map((t, i) => <p key={i}>{t}{streaming && i === p.other.length && <Caret />}</p>)}
        </div>
      ) : m.text && (p.kind === "cannot" ? (
        <article className="cp-card cannot" aria-label="Copilot cannot answer">
          <span className="cp-badge">can&apos;t answer from the data</span>
          <p>{p.headline}</p>
          {p.closest && <p><strong>Closest fact:</strong> {p.closest}</p>}
          {p.needed && <p><strong>Needed:</strong> {p.needed}</p>}
          {p.other.map((o) => <p key={o}>{o}</p>)}
          {p.next && <NextStep next={p.next} onDraft={onDraft} disabled={busy} />}
          {m.receipt && <Receipt r={m.receipt} />}
        </article>
      ) : (
        <article className="cp-card" aria-label="Copilot answer">
          <p className="cp-headline">{p.headline}{streaming && !p.bullets.length && <Caret />}</p>
          {p.bullets.length > 0 && <ul className="cp-bullets">{p.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
          {p.other.length > 0 && <div className="cp-other">{p.other.map((o, i) => <p key={i}>{o}</p>)}</div>}
          {streaming && p.bullets.length > 0 && <div className="cp-caret-row"><Caret /></div>}
          {(p.measured || p.judgement) && (
            <div className="cp-ej">
              <div><div className="good-text strong">Measured</div><div>{p.measured ?? "–"}</div></div>
              <div><div className="warn-text strong">Judgement</div><div>{p.judgement ?? "–"}</div></div>
            </div>
          )}
          {m.receipt && <Receipt r={m.receipt} />}
          {p.next && <NextStep next={p.next} onDraft={onDraft} disabled={busy || streaming} />}
        </article>
      ))}

      {(m.cards ?? []).map((c) => (
        <TaskCard key={c.item.item_id} card={c} meta={meta} onCard={onCard} setState={(s) => setCardState(c.item, s)} />
      ))}

      {streaming && <button type="button" className="btn secondary small" style={{ alignSelf: "flex-start" }} onClick={onStop}>Stop</button>}
      {m.status === "stopped" && <p className="small muted" style={{ margin: 0 }}>Stopped. <button type="button" className="link-btn" onClick={onRetry}>Ask again</button></p>}
      {m.status === "error" && (
        <div className="cp-note bad" role="alert">
          <strong>The answer didn&apos;t come through</strong>
          <p>{m.error ?? "Something went wrong."}</p>
          {m.retryable && <button type="button" className="btn danger small" onClick={onRetry} disabled={busy}>Retry</button>}
        </div>
      )}
    </div>
  );
}

function NextStep({ next, onDraft, disabled }: { next: string; onDraft: () => void; disabled: boolean }) {
  return (
    <div className="cp-next">
      <span>{next}</span>
      {offersTask(next) && <button type="button" className="cp-draft" onClick={onDraft} disabled={disabled}>Draft task</button>}
    </div>
  );
}

function Receipt({ r }: { r: ReceiptSummary }) {
  if (!r.asOf.length && !r.sources.length) return null;
  const head = [r.asOf.length ? `As of ${r.asOf.map(day).join(", ")}` : null, ...r.filters].filter(Boolean).join(" · ") || "No data tools used";
  return (
    <details className="cp-receipt">
      <summary>Receipt: {head}</summary>
      {r.tools.length > 0 && <p>Tools: {r.tools.join(", ")}.</p>}
      {r.metrics.length > 0 && <p>Metrics: {r.metrics.join(", ").replace(/_/g, " ")}.</p>}
      {r.sources.length > 0 && <p>Data: {r.sources.join(", ").replace(/_/g, " ")}.</p>}
      {r.assumptions.length > 0 && <p>Assumptions: {r.assumptions.join("; ")}.</p>}
      {r.warnings.map((w) => <p key={w} className="warn-text">{w}</p>)}
    </details>
  );
}

// ---------------------------------------------------------------- task card

function TaskCard({ card, meta, onCard, setState }: {
  card: Card; meta: Meta | null;
  onCard: (item: ActionItem, body: Record<string, unknown>) => void;
  setState: (s: Card["state"]) => void;
}) {
  const it = card.item;
  const [f, setF] = useState({
    title: it.title, campaign_id: it.campaign_id ?? "", owner_id: it.owner_id ?? "", due_date: it.due_date ?? "",
    priority: it.priority, description: it.reason,
  });
  const [reason, setReason] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  if (card.state === "created") {
    return (
      <div className="cp-note good" role="status">
        <strong><CheckIcon size={16} color="#067647" /> Task #{card.taskId} created</strong>
        <p>{f.title}{it.owner_name ? ` · ${meta?.team.find((t) => t.owner_id === f.owner_id)?.name ?? it.owner_name}` : ""}{f.due_date ? ` · due ${day(f.due_date)}` : ""}</p>
        <Link href={`/tasks?asOf=${it.as_of}`} className="link">View on Tasks</Link>
      </div>
    );
  }
  if (card.state === "dismissed") {
    return <div className="cp-note"><strong>Discarded</strong><p>{it.title}. No task was created.</p></div>;
  }

  const editing = card.state === "editing";
  const saving = card.state === "saving";
  const campaignName = meta?.campaigns.find((c) => c.campaign_id === f.campaign_id)?.campaign_name ?? it.campaign_name;
  const ownerName = meta?.team.find((t) => t.owner_id === f.owner_id)?.name ?? it.owner_name;

  return (
    <form className="cp-task" aria-label="Proposed task" onSubmit={(e) => { e.preventDefault(); onCard(it, { action: "accept", ...f }); }}>
      <div className="row-between" style={{ alignItems: "center" }}>
        <strong>Proposed task</strong>
        <span className="cp-tag">source: chatbot</span>
      </div>
      {editing ? (
        <>
          <label className="field">Title<input value={f.title} onChange={set("title")} maxLength={200} required /></label>
          <div className="cp-grid2">
            <label className="field">Campaign
              <select value={f.campaign_id} onChange={set("campaign_id")}>
                <option value="">None (cross-campaign)</option>
                {meta?.campaigns.map((c) => <option key={c.campaign_id} value={c.campaign_id}>{c.campaign_name}</option>)}
              </select>
            </label>
            <label className="field">Owner
              <select value={f.owner_id} onChange={set("owner_id")}>
                <option value="">Unassigned</option>
                {meta?.team.map((t) => <option key={t.owner_id} value={t.owner_id}>{t.name}</option>)}
              </select>
            </label>
            <label className="field">Due date<input type="date" value={f.due_date} onChange={set("due_date")} /></label>
            <label className="field">Priority
              <select value={f.priority} onChange={set("priority")}>
                <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
            </label>
          </div>
          <label className="field">Notes<textarea rows={3} value={f.description} onChange={set("description")} /></label>
        </>
      ) : (
        <dl className="cp-dl">
          <div><dt>Title</dt><dd>{f.title}</dd></div>
          <div><dt>Campaign</dt><dd>{campaignName ?? "None"}</dd></div>
          <div><dt>Owner</dt><dd>{ownerName ?? "Unassigned"}</dd></div>
          <div><dt>Due</dt><dd>{f.due_date ? day(f.due_date) : "No date"}</dd></div>
          <div><dt>Priority</dt><dd style={{ textTransform: "capitalize" }}>{f.priority}</dd></div>
          <div className="wide"><dt>Notes</dt><dd>{f.description}</dd></div>
        </dl>
      )}
      {card.error && <p className="small bad-text" role="alert" style={{ margin: 0 }}>{card.error}</p>}
      {card.state === "discarding" ? (
        <div className="stack" style={{ gap: 8 }}>
          <label className="field">Why discard? (optional)<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></label>
          <div className="row-wrap">
            <button type="button" className="btn danger small" onClick={() => onCard(it, { action: "dismiss", reason })}>Discard</button>
            <button type="button" className="btn secondary small" onClick={() => setState("open")}>Keep it</button>
          </div>
        </div>
      ) : (
        <>
          <p className="small muted" style={{ margin: 0 }}>Nothing is saved until you choose Create task.</p>
          <div className="row-wrap">
            <button type="submit" className="btn small-40" disabled={saving}>{saving ? "Creating…" : "Create task"}</button>
            {!editing && <button type="button" className="btn secondary small-40" onClick={() => setState("editing")} disabled={saving}>Edit</button>}
            <button type="button" className="btn ghost small-40" onClick={() => setState("discarding")} disabled={saving}>Discard</button>
          </div>
        </>
      )}
    </form>
  );
}

// ---------------------------------------------------------------- icons

const Caret = () => <span className="cp-caret" aria-hidden="true" />;
export const Sparkle = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /></svg>
);
const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
);
const ArrowIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
);
const StopIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
);
const OffIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#98A2B3" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="m3 3 18 18" /></svg>
);
