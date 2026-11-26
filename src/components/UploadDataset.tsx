"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
// Imported by path, not from the foundation index, so no database code reaches the browser.
import { DatasetError, type DatasetSnapshot } from "@/foundation/load";
import { snapshotFromCsv, snapshotFromWorkbook, type WorkbookLike } from "@/foundation/snapshot";
import { SpinnerIcon } from "./icons";

type State =
  | { kind: "idle" }
  | { kind: "busy"; label: string }
  | { kind: "error"; title: string; problems: string[]; more: number }
  | { kind: "done"; text: string };

async function readSnapshot(files: File[]): Promise<DatasetSnapshot> {
  const xlsx = files.filter((f) => /\.xlsx$/i.test(f.name));
  const csv = files.filter((f) => /\.csv$/i.test(f.name));
  const json = files.filter((f) => /\.json$/i.test(f.name));
  if (xlsx.length === 1 && files.length === 1) {
    // The spreadsheet library is large; it loads only when someone uploads a workbook.
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await xlsx[0].arrayBuffer());
    return snapshotFromWorkbook(wb as unknown as WorkbookLike, xlsx[0].name);
  }
  if (csv.length && csv.length === files.length) {
    const parts = await Promise.all(csv.map(async (f) => ({ name: f.name, text: await f.text() })));
    return snapshotFromCsv(parts, `${csv.length} CSV files`);
  }
  if (json.length === 1 && files.length === 1) {
    const snap = JSON.parse(await json[0].text()) as DatasetSnapshot;
    return { ...snap, source: json[0].name };
  }
  throw new DatasetError([
    "Choose one .xlsx workbook in the supplied layout, or all nine CSV files of the dataset's CSV copy, at once.",
  ]);
}

export function UploadDataset() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [over, setOver] = useState(false);

  async function handle(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    const label = files.length === 1 ? files[0].name : `${files.length} files`;
    setState({ kind: "busy", label: `Reading ${label}…` });
    try {
      const snap = await readSnapshot(files);
      setState({ kind: "busy", label: `Checking every row of ${label}…` });
      const res = await fetch("/api/dataset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(snap),
      });
      const body = await res.json();
      if (!body.ok) {
        setState({ kind: "error", title: `${label} was not loaded`, problems: body.problems ?? [], more: (body.total ?? 0) - (body.problems?.length ?? 0) });
        return;
      }
      const rows = (body.report as { uniqueRows: number }[]).reduce((s, r) => s + r.uniqueRows, 0);
      setState({ kind: "done", text: `${label} loaded: ${rows.toLocaleString("en-IN")} records. Every screen now uses it; reset returns to the original.` });
      router.refresh();
    } catch (e) {
      const problems = e instanceof DatasetError ? e.problems : [(e as Error).message || "The file could not be read."];
      setState({ kind: "error", title: `${label} was not loaded`, problems: problems.slice(0, 25), more: Math.max(0, problems.length - 25) });
    }
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <label
        className={`dropzone${over ? " over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#475467" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
        <strong>Drop a spreadsheet or the CSV files, or choose them</strong>
        <span className="text-13 muted">Checked in full before anything changes. Tasks are kept.</span>
        <input
          type="file"
          accept=".xlsx,.csv,.json"
          multiple
          className="sr-only"
          disabled={state.kind === "busy"}
          onChange={(e) => { handle(e.target.files); e.target.value = ""; }}
        />
      </label>
      {state.kind === "busy" && (
        <div className="banner info" role="status"><SpinnerIcon color="#1D4ED8" /><div className="grow">{state.label}</div></div>
      )}
      {state.kind === "error" && (
        <div className="problems" role="alert">
          <strong>{state.title}: {state.problems.length + state.more} problem{state.problems.length + state.more === 1 ? "" : "s"}</strong>
          <ol>{state.problems.map((p, i) => <li key={i}>{p}</li>)}</ol>
          {state.more > 0 && <div>…and {state.more} more.</div>}
          <div>The current data is unchanged. Fix these and upload again.</div>
        </div>
      )}
      {state.kind === "done" && <div className="banner success" role="status"><div className="grow">{state.text}</div></div>}
    </div>
  );
}
