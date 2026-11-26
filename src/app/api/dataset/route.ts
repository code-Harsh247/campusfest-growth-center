import { NextResponse } from "next/server";
import { DatasetError, loadDataset, parseSnapshot, type DatasetSnapshot } from "@/foundation";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Replaces the dataset. The browser reads the spreadsheet or CSV files and
 * sends their rows; every value is checked here before anything changes, and
 * a refused file leaves the current data untouched. Tasks are kept.
 */
export async function POST(req: Request) {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) {
    return NextResponse.json({ ok: false, problems: ["The file is larger than 25 MB."] }, { status: 413 });
  }
  let snap: DatasetSnapshot;
  try {
    snap = await req.json();
  } catch {
    return NextResponse.json({ ok: false, problems: ["The upload could not be read."] }, { status: 400 });
  }
  if (!snap || typeof snap !== "object" || typeof snap.tables !== "object" || snap.tables === null) {
    return NextResponse.json({ ok: false, problems: ["The upload is not a dataset."] }, { status: 400 });
  }
  const source = String(snap.source ?? "upload").slice(0, 120);
  try {
    const data = parseSnapshot({ source, tables: snap.tables });
    await loadDataset(await getDb(), data, "App user");
    return NextResponse.json({ ok: true, source, report: data.report });
  } catch (e) {
    if (e instanceof DatasetError) {
      return NextResponse.json({ ok: false, problems: e.problems.slice(0, 25), total: e.problems.length }, { status: 400 });
    }
    throw e;
  }
}
