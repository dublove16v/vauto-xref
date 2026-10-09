import { createServerFn } from "@tanstack/react-start";
import type { BodyFeed, BodyJob } from "@/lib/xref/body";
import { shopLabel, stockKey } from "@/lib/xref/body";
import type { Books } from "@/lib/xref/model";
import type { ArchiveEntry } from "@/lib/xref/archive";
import type { SyncInput, XrefSnapshot } from "@/lib/xref/store-db";

export type { XrefSnapshot };

const emptySnapshot = (): XrefSnapshot => ({ archives: [], desk: null, deskSavedAt: null });

export const loadXrefStore = createServerFn({ method: "GET" }).handler(async (): Promise<XrefSnapshot> => {
  const { getSql } = await import("@/lib/db");
  const db = await import("@/lib/xref/store-db");
  const sql = await getSql();
  const snapshot = await bundledSnapshot();
  await db.seedIfEmpty(sql, snapshot);
  return db.readStore(sql);
});

export const syncXrefStore = createServerFn({ method: "POST" })
  .validator((input: unknown) => parseSync(input))
  .handler(async ({ data }): Promise<XrefSnapshot> => {
    const { getSql } = await import("@/lib/db");
    const db = await import("@/lib/xref/store-db");
    const sql = await getSql();
    const snapshot = await db.syncStore(sql, data);
    await mirrorSnapshot(snapshot);
    return snapshot;
  });

export const removeXrefArchive = createServerFn({ method: "POST" })
  .validator((id: unknown) => {
    if (typeof id !== "string" || !id.trim() || id.length > 80) throw new Error("Missing archive");
    return id.trim();
  })
  .handler(async ({ data }): Promise<XrefSnapshot> => {
    const { getSql } = await import("@/lib/db");
    const db = await import("@/lib/xref/store-db");
    const sql = await getSql();
    const snapshot = await db.removeArchive(sql, data);
    await mirrorSnapshot(snapshot);
    return snapshot;
  });

export const loadBodyJobs = createServerFn({ method: "GET" }).handler(async (): Promise<BodyFeed> => {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const file = await readBodyFile();
  const stored = await sql<{ stock: string; shop: string; work: string; pulled_at: string }>`
    select stock, shop, work, pulled_at from body_jobs order by stock
  `;
  const storedAt = stored[0]?.pulled_at ?? "";
  if (!stored.length || (file.pulledAt && file.pulledAt > storedAt)) {
    await replaceBodyJobs(sql, file);
    return file;
  }
  return {
    pulledAt: storedAt,
    source: "BODY LIST 2.0",
    jobs: stored.map((row) => ({ stock: row.stock, shop: row.shop, work: row.work })),
  };
});

async function readBodyFile(): Promise<BodyFeed> {
  const empty: BodyFeed = { pulledAt: "", source: "BODY LIST 2.0", jobs: [] };
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const raw = await readFile(join(process.cwd(), "src/data/body-list.json"), "utf8");
    return cleanFeed(JSON.parse(raw), empty);
  } catch {
    try {
      const loaded = (await import("@/data/body-list.json")).default;
      return cleanFeed(loaded, empty);
    } catch {
      return empty;
    }
  }
}

async function replaceBodyJobs(
  sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>,
  feed: BodyFeed,
): Promise<void> {
  await sql`delete from body_jobs`;
  for (const job of feed.jobs) {
    await sql`insert into body_jobs (stock, shop, work, pulled_at) values (${job.stock}, ${job.shop}, ${job.work}, ${feed.pulledAt})`;
  }
}

function cleanFeed(value: unknown, fallback: BodyFeed): BodyFeed {
  if (!value || typeof value !== "object") return fallback;
  const row = value as Partial<BodyFeed>;
  if (!Array.isArray(row.jobs)) return fallback;
  const jobs: BodyJob[] = [];
  for (const item of row.jobs.slice(0, 2000)) {
    if (!item || typeof item !== "object") continue;
    const job = item as Partial<BodyJob>;
    const stock = typeof job.stock === "string" ? stockKey(job.stock) : "";
    if (!stock) continue;
    jobs.push({
      stock,
      shop: shopLabel(typeof job.shop === "string" ? job.shop : ""),
      work: typeof job.work === "string" ? job.work.slice(0, 400) : "",
    });
  }
  return {
    pulledAt: typeof row.pulledAt === "string" ? row.pulledAt : new Date().toISOString(),
    source: "BODY LIST 2.0",
    jobs,
  };
}

async function bundledSnapshot(): Promise<XrefSnapshot> {
  try {
    const loaded = (await import("@/data/xref-snapshot.json")).default as XrefSnapshot;
    return {
      archives: Array.isArray(loaded.archives) ? loaded.archives.filter(isEntry) : [],
      desk: isBooks(loaded.desk) ? loaded.desk : null,
      deskSavedAt: typeof loaded.deskSavedAt === "string" ? loaded.deskSavedAt : null,
    };
  } catch {
    return emptySnapshot();
  }
}

async function mirrorSnapshot(snapshot: XrefSnapshot): Promise<void> {
  try {
    const { readFile, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const path = join(process.cwd(), "src/data/xref-snapshot.json");
    const body = `${JSON.stringify(snapshot)}\n`;
    try {
      if ((await readFile(path, "utf8")) === body) return;
    } catch {
      // The file is created on the first save.
    }
    await writeFile(path, body);
  } catch {
    // Published hosting can't write the seed file. The database is the copy that lasts.
  }
}

function parseSync(input: unknown): SyncInput {
  if (!input || typeof input !== "object") throw new Error("Missing cross-reference");
  const row = input as Partial<SyncInput>;
  const archives = Array.isArray(row.archives) ? row.archives.filter(isEntry).slice(0, 30) : [];
  const desk = isBooks(row.desk) ? row.desk : null;
  const deskSavedAt = typeof row.deskSavedAt === "string" ? row.deskSavedAt : null;
  if (!archives.length && !desk) throw new Error("Nothing to save");
  return { archives, desk, deskSavedAt };
}

function isEntry(value: unknown): value is ArchiveEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as ArchiveEntry;
  if (typeof row.id !== "string" || typeof row.csv !== "string" || typeof row.filename !== "string") return false;
  if (!row.csv || row.csv.length > 2_000_000 || row.filename.length > 180) return false;
  if (row.books && !isBooks(row.books)) return false;
  row.vautoName = typeof row.vautoName === "string" ? row.vautoName.slice(0, 300) : "";
  row.dmsName = typeof row.dmsName === "string" ? row.dmsName.slice(0, 300) : "";
  row.savedAt = typeof row.savedAt === "string" ? row.savedAt : new Date().toISOString();
  row.total = Number(row.total) || 0;
  row.ready = Number(row.ready) || 0;
  row.vautoAsOf = typeof row.vautoAsOf === "string" ? row.vautoAsOf : null;
  row.dmsAsOf = typeof row.dmsAsOf === "string" ? row.dmsAsOf : null;
  return true;
}

function isBooks(value: unknown): value is Books {
  if (!value || typeof value !== "object") return false;
  const row = value as Books;
  return Array.isArray(row.vauto) && Array.isArray(row.dms) && row.vauto.length <= 8000 && row.dms.length <= 20000;
}
