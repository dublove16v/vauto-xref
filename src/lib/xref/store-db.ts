import { createHash } from "node:crypto";
import type { Books } from "@/lib/xref/model";
import type { ArchiveEntry } from "@/lib/xref/archive";

export type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type XrefSnapshot = {
  archives: ArchiveEntry[];
  desk: Books | null;
  deskSavedAt: string | null;
};

export type SyncInput = {
  archives: ArchiveEntry[];
  desk: Books | null;
  deskSavedAt: string | null;
};

const MAX_ARCHIVES = 30;

export function hashCsv(csv: string): string {
  return createHash("sha256").update(csv).digest("hex");
}

export async function readStore(sql: Sql): Promise<XrefSnapshot> {
  const archives = await sql<ArchiveRow>`
    select id, saved_at, filename, vauto_name, dms_name, vauto_as_of, dms_as_of, total, ready, csv, books_json
    from xref_archives
    order by saved_at desc
    limit ${MAX_ARCHIVES}
  `;
  const deskRows = await sql<DeskRow>`
    select books_json, updated_at from xref_desk where id = 'current'
  `;
  const desk = deskRows[0] ? parseBooks(deskRows[0].books_json) : null;
  return {
    archives: archives.map(toEntry),
    desk,
    deskSavedAt: deskRows[0]?.updated_at ?? null,
  };
}

export async function seedIfEmpty(sql: Sql, snapshot: XrefSnapshot): Promise<void> {
  const counts = await sql<{ archives: number | string; desk: number | string }>`
    select
      (select count(*)::int from xref_archives) as archives,
      (select count(*)::int from xref_desk) as desk
  `;
  if (Number(counts[0]?.archives ?? 0) > 0 || Number(counts[0]?.desk ?? 0) > 0) return;
  if (!snapshot.archives.length && !snapshot.desk) return;
  await syncStore(sql, {
    archives: snapshot.archives,
    desk: snapshot.desk,
    deskSavedAt: snapshot.deskSavedAt,
  });
}

export async function syncStore(sql: Sql, input: SyncInput): Promise<XrefSnapshot> {
  for (const entry of input.archives) {
    const hash = hashCsv(entry.csv);
    const found = await sql<{ id: string }>`
      select id from xref_archives where id = ${entry.id} or content_hash = ${hash} limit 1
    `;
    if (found.length) continue;
    await sql`
      insert into xref_archives (
        id, saved_at, filename, vauto_name, dms_name, vauto_as_of, dms_as_of, total, ready, csv, books_json, content_hash
      ) values (
        ${entry.id},
        ${entry.savedAt},
        ${entry.filename},
        ${entry.vautoName},
        ${entry.dmsName},
        ${entry.vautoAsOf},
        ${entry.dmsAsOf},
        ${entry.total},
        ${entry.ready},
        ${entry.csv},
        ${entry.books ? JSON.stringify(entry.books) : null},
        ${hash}
      )
    `;
  }
  if (input.archives.length) await pruneArchives(sql);
  if (input.desk) {
    const current = await sql<{ updated_at: string }>`
      select updated_at from xref_desk where id = 'current'
    `;
    const incoming = input.deskSavedAt ?? new Date().toISOString();
    const existing = current[0]?.updated_at ?? null;
    if (!existing || incoming > existing) {
      const savedAt = input.deskSavedAt ?? incoming;
      await sql`
        insert into xref_desk (id, books_json, updated_at)
        values ('current', ${JSON.stringify(input.desk)}, ${savedAt})
        on conflict (id) do update set books_json = excluded.books_json, updated_at = excluded.updated_at
      `;
    }
  }
  return readStore(sql);
}

export async function removeArchive(sql: Sql, id: string): Promise<XrefSnapshot> {
  await sql`delete from xref_archives where id = ${id}`;
  return readStore(sql);
}

async function pruneArchives(sql: Sql): Promise<void> {
  await sql`
    delete from xref_archives
    where id not in (
      select id from xref_archives order by saved_at desc limit ${MAX_ARCHIVES}
    )
  `;
}

type ArchiveRow = {
  id: string;
  saved_at: string;
  filename: string;
  vauto_name: string;
  dms_name: string;
  vauto_as_of: string | null;
  dms_as_of: string | null;
  total: number | string;
  ready: number | string;
  csv: string;
  books_json: string | null;
};

type DeskRow = {
  books_json: string;
  updated_at: string;
};

function toEntry(row: ArchiveRow): ArchiveEntry {
  return {
    id: row.id,
    savedAt: row.saved_at,
    filename: row.filename,
    vautoName: row.vauto_name,
    dmsName: row.dms_name,
    vautoAsOf: row.vauto_as_of,
    dmsAsOf: row.dms_as_of,
    total: Number(row.total),
    ready: Number(row.ready),
    csv: row.csv,
    books: parseBooks(row.books_json),
  };
}

function parseBooks(raw: string | null): Books | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Books;
    if (!value || !Array.isArray(value.vauto) || !Array.isArray(value.dms)) return null;
    return value;
  } catch {
    return null;
  }
}
