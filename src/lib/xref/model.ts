export type VautoRow = {
  vin: string;
  stock: string;
  vehicle: string;
  photos: number | null;
  photoFlag: boolean | null;
  age: number | null;
  miles: number | null;
  price: number | null;
  cost: number | null;
  color: string;
};

export type DmsRow = {
  vin: string;
  stock: string;
  description: string;
  emissions: string;
  key: string;
  age: number | null;
  miles: number | null;
  price: number | null;
  cost: number | null;
};

export type Books = {
  vauto: VautoRow[];
  dms: DmsRow[];
  vautoAsOf: string | null;
  dmsAsOf: string | null;
  vautoName: string;
  dmsName: string;
  dmsSeparate: boolean;
};

export type EmissionsKind = "date" | "xmpt" | "note" | "missing";
export type KeyState = "GOOD" | "CHECK" | null;
export type Designation = 1 | 2 | 3 | 4 | null;

export type Car = {
  vin: string;
  stock: string;
  vehicle: string;
  dmsDescription: string;
  photos: number | null;
  age: number | null;
  miles: number | null;
  price: number | null;
  listPrice: number | null;
  cost: number | null;
  color: string;
  emissions: string;
  key: string;
  combined: string;
  designation: Designation;
  keyState: KeyState;
  emissionsKind: EmissionsKind;
  onReport: boolean;
  hasPhotos: boolean;
  through: boolean;
  highDes: boolean;
  wholesale: boolean;
  awaiting: boolean;
  trade: boolean;
  bodyShop: string | null;
  bodyWork: string;
  ready: boolean;
  blockers: string[];
  passed: number;
};

export type FilterId =
  | "all"
  | "ready"
  | "photos"
  | "nophotos"
  | "needsphotos"
  | "highnophotos"
  | "through"
  | "needs"
  | "high"
  | "des1"
  | "des2"
  | "awaiting"
  | "wholesale"
  | "trade"
  | "body"
  | "close"
  | "offreport";

export type Parsed = {
  vauto: VautoRow[] | null;
  dms: DmsRow[] | null;
  asOf: string | null;
  name: string;
  dmsSeparate: boolean;
  error?: string;
};

type Sheet = { "!ref"?: string };
type Workbook = { SheetNames: string[]; Sheets: Record<string, Sheet> };
type XlsxApi = {
  utils: {
    sheet_to_json: (sheet: Sheet, opts: object) => unknown[][];
  };
};

const DATE_RE = /\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}-\d{1,2}-\d{2,4}/;

export function emissionsKind(emissions: string): EmissionsKind {
  const s = emissions.trim();
  if (!s) return "missing";
  if (/XMPT|EXEMPT/i.test(s)) return "xmpt";
  if (DATE_RE.test(s)) return "date";
  return "note";
}

export function parseDesignation(key: string): { n: Designation; state: KeyState } {
  const s = key.toUpperCase();
  const paired = s.match(/([1-4])\s*(GOOD|CHECK)/);
  if (paired) {
    return { n: Number(paired[1]) as Designation, state: paired[2] as KeyState };
  }
  const lead = s.match(/^\s*([1-4])\b/);
  if (lead) return { n: Number(lead[1]) as Designation, state: null };
  return { n: null, state: null };
}

export function isTradeStock(stock: string): boolean {
  return /(?:TL|PL|T|P)$/i.test(stock.trim());
}

export function saysWholesale(...parts: string[]): boolean {
  return parts.some((part) => /WS/i.test(part));
}

export function combineFields(emissions: string, key: string): string {
  const e = emissions.trim();
  const k = key.trim();
  if (e && k) return `${e}& ${k}`;
  if (k) return `& ${k}`;
  return e;
}

export function joinBooks(books: Books): Car[] {
  const byVin = new Map<string, DmsRow>();
  const stockCount = new Map<string, number>();
  for (const row of books.dms) {
    if (!byVin.has(row.vin)) byVin.set(row.vin, row);
    stockCount.set(row.stock, (stockCount.get(row.stock) ?? 0) + 1);
  }
  const byStock = new Map<string, DmsRow>();
  for (const row of books.dms) {
    if (stockCount.get(row.stock) === 1) byStock.set(row.stock, row);
  }

  return books.vauto.map((row) => {
    const dms = byVin.get(row.vin) ?? byStock.get(row.stock) ?? null;
    return scoreCar(row, dms);
  });
}

export function scoreCar(row: VautoRow, dms: DmsRow | null): Car {
  const onReport = dms != null;
  const emissions = dms?.emissions ?? "";
  const key = dms?.key ?? "";
  const kind = onReport ? emissionsKind(emissions) : "missing";
  const through = kind === "date" || kind === "xmpt";
  const designation = onReport ? parseDesignation(key) : { n: null as Designation, state: null as KeyState };
  const highDes = designation.n === 3 || designation.n === 4;
  const hasPhotos =
    (row.photos != null && row.photos > 0) || (row.photos == null && row.photoFlag === true);
  const wholesale = saysWholesale(emissions, key, row.vehicle, dms?.description ?? "", row.stock);
  const trade = isTradeStock(row.stock);
  const awaiting = designation.n === 1 && !through;

  const blockers: string[] = [];
  if (!hasPhotos) blockers.push("No photos");
  if (!onReport) blockers.push("Not on report");
  else {
    if (!through) blockers.push(kind === "missing" ? "No sticker" : "Not through emissions");
    if (!highDes) {
      blockers.push(designation.n == null ? "No designation" : `Des. ${designation.n}`);
    }
  }

  const passed = [hasPhotos, onReport && through, onReport && highDes].filter(Boolean).length;
  const ready = hasPhotos && onReport && through && highDes;

  return {
    vin: row.vin,
    stock: row.stock,
    vehicle: row.vehicle || dms?.description || "Unknown",
    dmsDescription: dms?.description ?? "",
    photos: row.photos,
    age: row.age ?? dms?.age ?? null,
    miles: row.miles ?? dms?.miles ?? null,
    price: row.price,
    listPrice: dms?.price ?? null,
    cost: row.cost ?? dms?.cost ?? null,
    color: row.color,
    emissions,
    key,
    combined: onReport ? combineFields(emissions, key) : "",
    designation: designation.n,
    keyState: designation.state,
    emissionsKind: kind,
    onReport,
    hasPhotos,
    through,
    highDes,
    wholesale,
    awaiting,
    trade,
    bodyShop: null,
    bodyWork: "",
    ready,
    blockers,
    passed,
  };
}

export function compareCars(a: Car, b: Car): number {
  const age = (b.age ?? -1) - (a.age ?? -1);
  if (age !== 0) return age;
  return a.stock.localeCompare(b.stock);
}

export function matchesFilter(car: Car, filter: FilterId): boolean {
  switch (filter) {
    case "ready":
      return car.ready;
    case "photos":
      return car.hasPhotos;
    case "nophotos":
      return !car.hasPhotos;
    case "needsphotos":
      return !car.hasPhotos && car.through;
    case "highnophotos":
      return !car.hasPhotos && car.through && car.highDes;
    case "through":
      return car.through;
    case "needs":
      return car.onReport && !car.through;
    case "high":
      return car.highDes;
    case "des1":
      return car.designation === 1;
    case "des2":
      return car.designation === 2;
    case "awaiting":
      return car.awaiting;
    case "wholesale":
      return car.wholesale;
    case "trade":
      return car.trade;
    case "body":
      return car.bodyShop != null;
    case "close":
      return car.highDes && !car.ready;
    case "offreport":
      return !car.onReport;
    default:
      return true;
  }
}

export function matchesQuery(car: Car, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [car.stock, car.vin, car.vehicle, car.dmsDescription, car.emissions, car.key, car.combined, car.designation ?? "", car.trade ? "trade" : "", car.bodyShop ?? "", car.bodyWork]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

export function countCars(cars: Car[]) {
  return {
    all: cars.length,
    ready: cars.filter((c) => c.ready).length,
    photos: cars.filter((c) => c.hasPhotos).length,
    nophotos: cars.filter((c) => !c.hasPhotos).length,
    needsphotos: cars.filter((c) => !c.hasPhotos && c.through).length,
    highnophotos: cars.filter((c) => !c.hasPhotos && c.through && c.highDes).length,
    through: cars.filter((c) => c.through).length,
    needs: cars.filter((c) => c.onReport && !c.through).length,
    high: cars.filter((c) => c.highDes).length,
    des1: cars.filter((c) => c.designation === 1).length,
    des2: cars.filter((c) => c.designation === 2).length,
    awaiting: cars.filter((c) => c.awaiting).length,
    wholesale: cars.filter((c) => c.wholesale).length,
    trade: cars.filter((c) => c.trade).length,
    body: cars.filter((c) => c.bodyShop != null).length,
    close: cars.filter((c) => c.highDes && !c.ready).length,
    offreport: cars.filter((c) => !c.onReport).length,
  };
}

export function toCsv(cars: Car[]): string {
  const headers = [
    "Stock #",
    "VIN",
    "Vehicle",
    "Age",
    "Body",
    "Photos",
    "Emissions",
    "Key Code",
    "Designation",
    "EMISSIONS& KEY CODE",
    "Advertise",
  ];
  const lines = [headers.join(",")];
  for (const car of cars) {
    lines.push(
      [
        car.stock,
        car.vin,
        car.vehicle,
        car.age ?? "",
        car.bodyShop ?? "",
        car.photos ?? "",
        car.emissions,
        car.key,
        car.designation ?? "",
        car.combined,
        car.ready ? "YES" : "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

export function toTsv(cars: Car[]): string {
  const header = ["Stock #", "VIN", "Vehicle", "Photos", "Designation", "EMISSIONS& KEY CODE"].join("\t");
  const lines = cars.map((car) =>
    [car.stock, car.vin, car.vehicle, car.photos ?? "", car.designation ?? "", car.combined].join("\t"),
  );
  return [header, ...lines].join("\n");
}

function csvCell(value: unknown): string {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function formatMoney(value: number | null): string {
  if (value == null) return "—";
  if (Math.abs(value) >= 100000) return Math.round(value).toLocaleString("en-US");
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function formatMiles(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value).toLocaleString("en-US")} mi`;
}

export function formatAsOf(iso: string | null): string {
  if (!iso) return "date unknown";
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${Number(month)}/${Number(day)}/${year.slice(2)}`;
}

export function pickBooks(parts: Parsed[], previous?: Books | null): Books {
  const vautoCandidates: { rows: VautoRow[]; asOf: string | null; name: string; score: number }[] = [];
  const dmsCandidates: { rows: DmsRow[]; asOf: string | null; name: string; separate: boolean; score: number }[] =
    [];

  if (previous && previous.vauto.length) {
    vautoCandidates.push({
      rows: previous.vauto,
      asOf: previous.vautoAsOf,
      name: previous.vautoName,
      score: scoreVauto(previous.vauto),
    });
  }
  if (previous && previous.dms.length) {
    dmsCandidates.push({
      rows: previous.dms,
      asOf: previous.dmsAsOf,
      name: previous.dmsName,
      separate: previous.dmsSeparate,
      score: scoreDms(previous.dms, previous.dmsSeparate, previous.dmsAsOf),
    });
  }

  for (const part of parts) {
    if (part.vauto && part.vauto.length) {
      vautoCandidates.push({
        rows: part.vauto,
        asOf: part.asOf,
        name: part.name,
        score: scoreVauto(part.vauto),
      });
    }
    if (part.dms && part.dms.length) {
      dmsCandidates.push({
        rows: part.dms,
        asOf: part.asOf,
        name: part.name,
        separate: part.dmsSeparate,
        score: scoreDms(part.dms, part.dmsSeparate, part.asOf),
      });
    }
  }

  vautoCandidates.sort((a, b) => b.score - a.score);
  dmsCandidates.sort((a, b) => b.score - a.score);
  const vauto = vautoCandidates[0];
  const dms = dmsCandidates[0];

  return {
    vauto: vauto?.rows ?? [],
    dms: dms?.rows ?? [],
    vautoAsOf: vauto?.asOf ?? null,
    dmsAsOf: dms?.asOf ?? null,
    vautoName: vauto?.name ?? "",
    dmsName: dms?.name ?? "",
    dmsSeparate: dms?.separate ?? false,
  };
}

function scoreVauto(rows: VautoRow[]): number {
  let numeric = 0;
  for (const row of rows) if (typeof row.photos === "number") numeric += 1;
  return numeric * 1000 + rows.length;
}

function scoreDms(rows: DmsRow[], separate: boolean, asOf: string | null): number {
  const dateScore = asOf ? Number(asOf.replace(/-/g, "")) : 0;
  return (separate ? 1_000_000_000 : 0) + dateScore * 1000 + rows.length;
}

type Reader = XlsxApi & {
  read: (data: ArrayBuffer, opts: object) => Workbook;
};

function readerOf(mod: unknown): Reader {
  const record = mod as Reader & { default?: Reader };
  if (typeof record.read === "function" && record.utils) return record;
  if (record.default && typeof record.default.read === "function" && record.default.utils) return record.default;
  throw new Error("Could not read that spreadsheet.");
}

export async function parseFile(file: File): Promise<Parsed> {
  const loaded: unknown = await import("xlsx");
  const api = readerOf(loaded);
  const buf = await file.arrayBuffer();
  const wb = api.read(buf, { type: "array", cellDates: true });
  return parseWorkbook(api, wb, file.name);
}

export function parseWorkbook(xlsx: XlsxApi, wb: Workbook, filename: string): Parsed {
  const names = wb.SheetNames ?? [];
  const revoName = names.find((name) => name.trim().toLowerCase() === "revo");
  const dmsSheetName = names.find((name) => name.trim().toLowerCase() === "dms");

  if (revoName) {
    const revoRows = sheetToRows(xlsx, wb.Sheets[revoName]);
    const revo = parseSheet(revoRows);
    let dms = revo.dms;
    let separate = revo.separate;
    let asOf = asOfFrom(filename, dmsSheetName ? sheetToRows(xlsx, wb.Sheets[dmsSheetName]).slice(0, 2) : revoRows);
    if (dmsSheetName) {
      const dmsRows = sheetToRows(xlsx, wb.Sheets[dmsSheetName]);
      const parsed = parseSheet(dmsRows);
      if (parsed.dms && parsed.dms.length) {
        dms = parsed.dms;
        separate = parsed.separate;
        asOf = asOfFrom(filename, dmsRows) ?? asOf;
      }
    }
    if (!revo.vauto && !dms) {
      return emptyParsed(filename, "Couldn't find stock # and VIN columns.");
    }
    return {
      vauto: revo.vauto,
      dms,
      asOf: asOf ?? fromName(filename),
      name: filename,
      dmsSeparate: separate,
    };
  }

  for (const name of names) {
    const rows = sheetToRows(xlsx, wb.Sheets[name]);
    const parsed = parseSheet(rows);
    if ((parsed.vauto && parsed.vauto.length) || (parsed.dms && parsed.dms.length)) {
      return {
        vauto: parsed.vauto,
        dms: parsed.dms,
        asOf: asOfFrom(filename, rows),
        name: filename,
        dmsSeparate: parsed.separate,
      };
    }
  }

  return emptyParsed(filename, "Couldn't find stock # and VIN columns.");
}

function emptyParsed(filename: string, error: string): Parsed {
  return { vauto: null, dms: null, asOf: null, name: filename, dmsSeparate: false, error };
}

function parseSheet(rows: unknown[][]): {
  vauto: VautoRow[] | null;
  dms: DmsRow[] | null;
  separate: boolean;
} {
  const headerAt = findHeader(rows);
  if (headerAt < 0) return { vauto: null, dms: null, separate: false };
  const cols = mapColumns(rows[headerAt] ?? []);
  const isVauto = cols.photoCount != null || cols.photos != null || cols.yes != null;
  const isDms = cols.emissions != null || cols.key != null || cols.combined != null;
  const separate = cols.emissions != null && cols.key != null;
  const vauto: VautoRow[] = [];
  const dms: DmsRow[] = [];

  for (let i = headerAt + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) continue;
    const vin = normVin(cell(row, cols.vin));
    if (vin.length < 11) continue;
    const stock = normStock(cell(row, cols.stock)) || vin.slice(-8);

    if (isVauto) {
      let photos: number | null = null;
      if (cols.photoCount != null) photos = num(cell(row, cols.photoCount));
      else if (cols.photos != null) photos = num(cell(row, cols.photos));
      let photoFlag: boolean | null = null;
      if (cols.yes != null) {
        const flag = text(cell(row, cols.yes)).toUpperCase();
        if (flag === "YES") photoFlag = true;
        else if (flag === "NO") photoFlag = false;
      }
      vauto.push({
        vin,
        stock,
        vehicle: cols.vehicle != null ? text(cell(row, cols.vehicle)) : "",
        photos,
        photoFlag,
        age: cols.age != null ? num(cell(row, cols.age)) : null,
        miles: cols.miles != null ? num(cell(row, cols.miles)) : null,
        price: cols.price != null ? num(cell(row, cols.price)) : null,
        cost: cols.cost != null ? num(cell(row, cols.cost)) : null,
        color: cols.color != null ? text(cell(row, cols.color)) : "",
      });
    }

    if (isDms) {
      const fields = readEmissionsKey(row, cols, separate);
      dms.push({
        vin,
        stock,
        description: cols.vehicle != null ? text(cell(row, cols.vehicle)) : "",
        emissions: fields.emissions,
        key: fields.key,
        age: cols.age != null ? num(cell(row, cols.age)) : null,
        miles: cols.miles != null ? num(cell(row, cols.miles)) : null,
        price: cols.price != null ? num(cell(row, cols.price)) : null,
        cost: cols.cost != null ? num(cell(row, cols.cost)) : null,
      });
    }
  }

  return {
    vauto: isVauto ? vauto : null,
    dms: isDms ? dms : null,
    separate,
  };
}

function readEmissionsKey(
  row: unknown[],
  cols: ColumnMap,
  separate: boolean,
): { emissions: string; key: string } {
  if (!separate && cols.combined != null) return splitCombined(text(cell(row, cols.combined)));
  let emissions = cols.emissions != null ? text(cell(row, cols.emissions)) : "";
  let key = cols.key != null ? text(cell(row, cols.key)) : "";
  if (!emissions && !key && cols.combined != null) return splitCombined(text(cell(row, cols.combined)));
  if (emissions && !key && emissions.includes("&")) return splitCombined(emissions);
  return { emissions, key };
}

export function splitCombined(raw: string): { emissions: string; key: string } {
  const s = raw.trim();
  if (!s) return { emissions: "", key: "" };
  const at = s.indexOf("&");
  if (at === -1) {
    if (/GOOD|CHECK|SAG|BTSUNDAY|\bWS\b/i.test(s) && !DATE_RE.test(s) && !/XMPT/i.test(s)) {
      return { emissions: "", key: s };
    }
    return { emissions: s, key: "" };
  }
  return { emissions: s.slice(0, at).trim(), key: s.slice(at + 1).trim() };
}

type ColumnMap = {
  stock?: number;
  vin?: number;
  vehicle?: number;
  photoCount?: number;
  photos?: number;
  yes?: number;
  age?: number;
  miles?: number;
  price?: number;
  cost?: number;
  color?: number;
  emissions?: number;
  key?: number;
  combined?: number;
};

function mapColumns(header: unknown[]): ColumnMap {
  const cols: ColumnMap = {};
  header.forEach((value, index) => {
    const h = normHeader(value);
    if (!h) return;
    const set = (key: keyof ColumnMap) => {
      if (cols[key] == null) cols[key] = index;
    };
    if (h === "stock #" || h === "stock#" || h === "stock") set("stock");
    else if (h === "vin") set("vin");
    else if (h === "vehicle" || h === "vehicle description") set("vehicle");
    else if (h === "photo count") set("photoCount");
    else if (h === "photos") set("photos");
    else if (h === "yes") set("yes");
    else if (h === "age") set("age");
    else if (h === "miles" || h === "odometer") set("miles");
    else if (h === "price" || h === "list") set("price");
    else if (h === "cost") set("cost");
    else if (h === "color") set("color");
    else if (h.includes("emission") && h.includes("key")) set("combined");
    else if (h === "emissions" || h === "emission") set("emissions");
    else if (h === "key code" || h === "keycode" || h === "keys") set("key");
  });
  return cols;
}

function findHeader(rows: unknown[][]): number {
  const limit = Math.min(rows.length, 30);
  for (let i = 0; i < limit; i += 1) {
    const row = rows[i] ?? [];
    let vin = false;
    let stock = false;
    for (const value of row) {
      const h = normHeader(value);
      if (h === "vin") vin = true;
      if (h === "stock #" || h === "stock#" || h === "stock") stock = true;
    }
    if (vin && stock) return i;
  }
  return -1;
}

function sheetToRows(xlsx: XlsxApi, sheet: Sheet | undefined): unknown[][] {
  if (!sheet) return [];
  if (sheet["!ref"]) {
    const match = sheet["!ref"].match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (match && Number(match[4]) > 8000) {
      sheet["!ref"] = `${match[1]}${match[2]}:${match[3]}8000`;
    }
  }
  return xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: false });
}

function asOfFrom(filename: string, rows: unknown[][]): string | null {
  const banner = rows
    .slice(0, 2)
    .map((row) => (row ?? []).map((value) => (value == null ? "" : String(value))).join(" "))
    .join(" ");
  const split = banner.match(/1\s*&?\s*0\/(\d{1,2})\/(\d{2})\b/);
  if (split?.[1] && split[2]) return iso(2000 + Number(split[2]), 10, Number(split[1]));
  const full = banner.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (full?.[1] && full[2] && full[3]) {
    const year = full[3].length === 2 ? 2000 + Number(full[3]) : Number(full[3]);
    return iso(year, Number(full[1]), Number(full[2]));
  }
  return fromName(filename);
}

function fromName(name: string): string | null {
  const isoMatch = name.match(/(20\d{2})[-_](\d{1,2})[-_](\d{1,2})/);
  if (isoMatch?.[1] && isoMatch[2] && isoMatch[3]) {
    return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }
  const us = name.match(/(?:^|[^\d])(\d{1,2})[-_](\d{1,2})[-_](\d{2,4})(?:[^\d]|$)/);
  if (us?.[1] && us[2] && us[3]) {
    const year = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    return iso(year, Number(us[1]), Number(us[2]));
  }
  return null;
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function cell(row: unknown[], index: number | undefined): unknown {
  if (index == null) return null;
  return row[index];
}

function normHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normVin(value: unknown): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normStock(value: unknown): string {
  return String(value ?? "")
    .replace(/^\*/, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(String(value).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}
