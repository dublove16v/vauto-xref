import { compareCars, joinBooks, toCsv, type Books } from "@/lib/xref/model";

const ARCHIVE_KEY = "vauto-xref-archives";
const DESK_KEY = "vauto-xref-desk";
const MAX_ARCHIVES = 12;
const BOOKS_KEPT = 5;

export type ArchiveEntry = {
  id: string;
  savedAt: string;
  filename: string;
  vautoName: string;
  dmsName: string;
  vautoAsOf: string | null;
  dmsAsOf: string | null;
  total: number;
  ready: number;
  csv: string;
  books: Books | null;
};

export type SavedDesk = {
  books: Books;
  usingSample: boolean;
  savedAt?: string | null;
};

export function xrefFilename(date = new Date(), group?: string): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = String(date.getFullYear()).slice(2);
  const stamp = `${month}-${day}-${year}`;
  const clean = group?.replace(/[\\/:*?"<>|,]+/g, " ").replace(/\s+/g, " ").trim();
  return clean ? `vauto xref ${clean} ${stamp}.csv` : `vauto xref ${stamp}.csv`;
}

export function listArchives(): ArchiveEntry[] {
  return readList();
}

export function archiveBooks(books: Books, now = new Date()): ArchiveEntry | null {
  if (!books.vauto.length || !books.dms.length) return null;
  const cars = joinBooks(books).sort(compareCars);
  const csv = toCsv(cars);
  const existing = readList();
  if (existing[0]?.csv === csv) return null;
  const taken = new Set(existing.map((entry) => entry.filename));
  const entry: ArchiveEntry = {
    id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    savedAt: now.toISOString(),
    filename: uniqueFilename(now, taken),
    vautoName: books.vautoName,
    dmsName: books.dmsName,
    vautoAsOf: books.vautoAsOf,
    dmsAsOf: books.dmsAsOf,
    total: cars.length,
    ready: cars.filter((car) => car.ready).length,
    csv,
    books,
  };
  const next = [entry, ...existing].slice(0, MAX_ARCHIVES).map((item, index) =>
    index < BOOKS_KEPT ? item : { ...item, books: null },
  );
  return writeList(next) ? entry : null;
}

export function forgetArchive(id: string): ArchiveEntry[] {
  const next = readList().filter((entry) => entry.id !== id);
  writeList(next);
  return readList();
}

export function readDesk(): SavedDesk | null {
  try {
    const raw = localStorage.getItem(DESK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedDesk>;
    if (parsed.usingSample || !parsed.books) return null;
    if (!Array.isArray(parsed.books.vauto) || !Array.isArray(parsed.books.dms)) return null;
    return {
      books: parsed.books,
      usingSample: false,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : null,
    };
  } catch {
    return null;
  }
}

export function writeDesk(desk: SavedDesk): void {
  try {
    if (desk.usingSample) {
      localStorage.setItem(DESK_KEY, JSON.stringify({ usingSample: true, books: null }));
      return;
    }
    const previous = readDesk();
    const same = previous != null && JSON.stringify(previous.books) === JSON.stringify(desk.books);
    const savedAt = desk.savedAt ?? (same ? previous?.savedAt : null) ?? new Date().toISOString();
    localStorage.setItem(DESK_KEY, JSON.stringify({ books: desk.books, usingSample: false, savedAt }));
  } catch {
    // The archive list is the backup if this browser refuses the working copy.
  }
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function uniqueFilename(date: Date, taken: Set<string>): string {
  const base = xrefFilename(date);
  if (!taken.has(base)) return base;
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "pm" : "am";
  hours = hours % 12 || 12;
  const timed = `vauto xref ${date.getMonth() + 1}-${date.getDate()}-${String(date.getFullYear()).slice(2)} ${hours}-${minutes}${ampm}.csv`;
  if (!taken.has(timed)) return timed;
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return timed.replace(".csv", `-${seconds}.csv`);
}

function readList(): ArchiveEntry[] {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isArchive);
  } catch {
    return [];
  }
}

function writeList(entries: ArchiveEntry[]): boolean {
  let current = entries;
  for (let attempt = 0; attempt < 8 && current.length; attempt += 1) {
    try {
      localStorage.setItem(ARCHIVE_KEY, JSON.stringify(current));
      return true;
    } catch {
      const stripped = current.map((item, index) => (index === 0 ? item : { ...item, books: null }));
      if (stripped.some((item, index) => item.books !== current[index]?.books)) {
        current = stripped;
        continue;
      }
      current = current.slice(0, -1);
    }
  }
  return false;
}

function isArchive(value: unknown): value is ArchiveEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ArchiveEntry>;
  return typeof row.id === "string" && typeof row.csv === "string" && typeof row.filename === "string" && typeof row.savedAt === "string";
}
