"""vAuto X-Ref scoring and spreadsheet reading."""

from __future__ import annotations

import io
import json
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

ROOT = Path(__file__).resolve().parent
DATE_RE = re.compile(r"\d{1,2}/\d{1,2}/\d{2,4}|\d{1,2}-\d{1,2}-\d{2,4}")

FILTERS: list[tuple[str, str, str]] = [
    ("ready", "To Be Advertised", "Photos, emissions, and a 3 or 4"),
    ("photos", "Has Photos", "Photo count is above zero"),
    ("nophotos", "No Photos", "Photo count is zero"),
    ("needsphotos", "No Photos, Has Emissions", "A date or XMPT, and no photos"),
    ("highnophotos", "Has Emissions, 3 or 4, No Photos", "A date or XMPT, a 3 or 4, and no photos"),
    ("through", "Through Emissions", "Emissions is a date or XMPT"),
    ("needs", "Needs Emissions", "On the report, with no date or XMPT"),
    ("des1", "Vehicle Status 1", "Designation is 1"),
    ("des2", "Vehicle Status 2", "Designation is 2"),
    ("high", "Vehicle Status 3 or 4", "Designation is 3 or 4"),
    ("awaiting", "Awaiting Transport", "A 1 with no emissions"),
    ("wholesale", "Wholesale", "Key code says WS"),
    ("trade", "Trade", "Stock ends in T, P, TL, or PL"),
    ("body", "On Body List", "On BODY LIST 2.0"),
    ("close", "Close", "A 3 or 4 that is not ready to advertise yet"),
    ("offreport", "Not on Report", "On vAuto, missing from the report"),
]
FILTER_LABEL = {fid: label for fid, label, _hint in FILTERS}


@dataclass
class VautoRow:
    vin: str
    stock: str
    vehicle: str
    photos: float | None
    photoFlag: bool | None
    age: float | None
    miles: float | None
    price: float | None
    cost: float | None
    color: str


@dataclass
class DmsRow:
    vin: str
    stock: str
    description: str
    emissions: str
    key: str
    age: float | None
    miles: float | None
    price: float | None
    cost: float | None


@dataclass
class Books:
    vauto: list[VautoRow] = field(default_factory=list)
    dms: list[DmsRow] = field(default_factory=list)
    vautoAsOf: str | None = None
    dmsAsOf: str | None = None
    vautoName: str = ""
    dmsName: str = ""
    dmsSeparate: bool = False

    def to_json(self) -> str:
        return json.dumps(
            {
                "vauto": [asdict(row) for row in self.vauto],
                "dms": [asdict(row) for row in self.dms],
                "vautoAsOf": self.vautoAsOf,
                "dmsAsOf": self.dmsAsOf,
                "vautoName": self.vautoName,
                "dmsName": self.dmsName,
                "dmsSeparate": self.dmsSeparate,
            }
        )

    @classmethod
    def from_json(cls, raw: str | dict) -> Books:
        data = json.loads(raw) if isinstance(raw, str) else raw
        return cls(
            vauto=[VautoRow(**row) for row in data.get("vauto") or []],
            dms=[DmsRow(**row) for row in data.get("dms") or []],
            vautoAsOf=data.get("vautoAsOf"),
            dmsAsOf=data.get("dmsAsOf"),
            vautoName=data.get("vautoName") or "",
            dmsName=data.get("dmsName") or "",
            dmsSeparate=bool(data.get("dmsSeparate")),
        )


@dataclass
class Car:
    vin: str
    stock: str
    vehicle: str
    dmsDescription: str
    photos: float | None
    age: float | None
    miles: float | None
    price: float | None
    listPrice: float | None
    cost: float | None
    color: str
    emissions: str
    key: str
    combined: str
    designation: int | None
    keyState: str | None
    emissionsKind: str
    onReport: bool
    hasPhotos: bool
    through: bool
    highDes: bool
    wholesale: bool
    awaiting: bool
    trade: bool
    bodyShop: str | None
    bodyWork: str
    ready: bool
    blockers: list[str]
    passed: int


def emissions_kind(emissions: str) -> str:
    s = emissions.strip()
    if not s:
        return "missing"
    if re.search(r"XMPT|EXEMPT", s, re.I):
        return "xmpt"
    if DATE_RE.search(s):
        return "date"
    return "note"


def parse_designation(key: str) -> tuple[int | None, str | None]:
    s = key.upper()
    paired = re.search(r"([1-4])\s*(GOOD|CHECK)", s)
    if paired:
        return int(paired.group(1)), paired.group(2)
    lead = re.match(r"\s*([1-4])\b", s)
    if lead:
        return int(lead.group(1)), None
    return None, None


def is_trade_stock(stock: str) -> bool:
    return bool(re.search(r"(?:TL|PL|T|P)$", stock.strip(), re.I))


def says_wholesale(*parts: str) -> bool:
    return any(re.search(r"WS", part or "", re.I) for part in parts)


def combine_fields(emissions: str, key: str) -> str:
    e = emissions.strip()
    k = key.strip()
    if e and k:
        return f"{e}& {k}"
    if k:
        return f"& {k}"
    return e


def score_car(row: VautoRow, dms: DmsRow | None) -> Car:
    on_report = dms is not None
    emissions = dms.emissions if dms else ""
    key = dms.key if dms else ""
    kind = emissions_kind(emissions) if on_report else "missing"
    through = kind in ("date", "xmpt")
    designation, state = parse_designation(key) if on_report else (None, None)
    high = designation in (3, 4)
    has_photos = (row.photos is not None and row.photos > 0) or (row.photos is None and row.photoFlag is True)
    wholesale = says_wholesale(emissions, key, row.vehicle, dms.description if dms else "", row.stock)
    trade = is_trade_stock(row.stock)
    awaiting = designation == 1 and not through
    blockers: list[str] = []
    if not has_photos:
        blockers.append("No photos")
    if not on_report:
        blockers.append("Not on report")
    else:
        if not through:
            blockers.append("No sticker" if kind == "missing" else "Not through emissions")
        if not high:
            blockers.append("No designation" if designation is None else f"Des. {designation}")
    passed = sum([has_photos, on_report and through, on_report and high])
    ready = has_photos and on_report and through and high
    return Car(
        vin=row.vin,
        stock=row.stock,
        vehicle=row.vehicle or (dms.description if dms else "") or "Unknown",
        dmsDescription=dms.description if dms else "",
        photos=row.photos,
        age=row.age if row.age is not None else (dms.age if dms else None),
        miles=row.miles if row.miles is not None else (dms.miles if dms else None),
        price=row.price,
        listPrice=dms.price if dms else None,
        cost=row.cost if row.cost is not None else (dms.cost if dms else None),
        color=row.color,
        emissions=emissions,
        key=key,
        combined=combine_fields(emissions, key) if on_report else "",
        designation=designation,
        keyState=state,
        emissionsKind=kind,
        onReport=on_report,
        hasPhotos=has_photos,
        through=through,
        highDes=high,
        wholesale=wholesale,
        awaiting=awaiting,
        trade=trade,
        bodyShop=None,
        bodyWork="",
        ready=ready,
        blockers=blockers,
        passed=passed,
    )


def join_books(books: Books) -> list[Car]:
    by_vin: dict[str, DmsRow] = {}
    stock_count: dict[str, int] = {}
    for row in books.dms:
        by_vin.setdefault(row.vin, row)
        stock_count[row.stock] = stock_count.get(row.stock, 0) + 1
    by_stock = {row.stock: row for row in books.dms if stock_count.get(row.stock) == 1}
    return [score_car(row, by_vin.get(row.vin) or by_stock.get(row.stock)) for row in books.vauto]


def compare_key(car: Car) -> tuple:
    return (-(car.age if car.age is not None else -1), car.stock)


def matches_filter(car: Car, filt: str) -> bool:
    return {
        "ready": car.ready,
        "photos": car.hasPhotos,
        "nophotos": not car.hasPhotos,
        "needsphotos": (not car.hasPhotos) and car.through,
        "highnophotos": (not car.hasPhotos) and car.through and car.highDes,
        "through": car.through,
        "needs": car.onReport and not car.through,
        "high": car.highDes,
        "des1": car.designation == 1,
        "des2": car.designation == 2,
        "awaiting": car.awaiting,
        "wholesale": car.wholesale,
        "trade": car.trade,
        "body": car.bodyShop is not None,
        "close": car.highDes and not car.ready,
        "offreport": not car.onReport,
    }.get(filt, True)


def matches_query(car: Car, query: str) -> bool:
    q = query.strip().lower()
    if not q:
        return True
    blob = " ".join(
        [
            car.stock,
            car.vin,
            car.vehicle,
            car.dmsDescription,
            car.emissions,
            car.key,
            car.combined,
            "" if car.designation is None else str(car.designation),
            "trade" if car.trade else "",
            car.bodyShop or "",
            car.bodyWork,
        ]
    ).lower()
    return q in blob


def count_cars(cars: list[Car]) -> dict[str, int]:
    counts = {"all": len(cars)}
    for fid, _label, _hint in FILTERS:
        counts[fid] = sum(1 for car in cars if matches_filter(car, fid))
    return counts


def mark_of(car: Car) -> str:
    if car.wholesale:
        return "WS"
    return str(car.designation) if car.designation else "–"


def result_of(car: Car) -> str:
    if car.ready:
        return "Trade · Advertise" if car.trade else "Advertise"
    if car.trade:
        tail = " · ".join(car.blockers)
        return f"Trade · {tail}" if tail else "Trade"
    return " · ".join(car.blockers)


def photo_of(car: Car) -> str:
    if car.photos is not None and car.photos > 0:
        return str(int(car.photos)) if float(car.photos).is_integer() else str(car.photos)
    if car.hasPhotos:
        return "Yes"
    return "None"


def apply_body(cars: list[Car], jobs: list[dict]) -> None:
    index: dict[str, dict] = {}
    for job in jobs:
        stock = stock_key(str(job.get("stock") or ""))
        if not stock:
            continue
        prev = index.get(stock)
        work = str(job.get("work") or "")
        if prev and prev["work"] and prev["work"] != work:
            work = f"{prev['work']}; {work}"
        index[stock] = {"shop": shop_label(str(job.get("shop") or "")), "work": work}
    for car in cars:
        job = index.get(stock_key(car.stock))
        car.bodyShop = job["shop"] if job else None
        car.bodyWork = job["work"] if job else ""


def stock_key(stock: str) -> str:
    return re.sub(r"[^a-z0-9]", "", stock, flags=re.I).upper()


def shop_label(raw: str) -> str:
    name = raw.strip().lower()
    if not name:
        return "Body"
    if name.startswith("ruiz"):
        return "Ruiz"
    if name.startswith("master"):
        return "Master"
    if name.startswith("robb"):
        return "Robb"
    return raw.strip()


def stock_from_body_vehicle(vehicle: str) -> str | None:
    parts = vehicle.strip().split()
    last = parts[-1] if parts else ""
    if not re.search(r"\d", last):
        return None
    key = stock_key(last)
    if not re.search(r"[a-z]", key, re.I) and len(key) < 5:
        return None
    return key or None


def csv_cell(value: Any) -> str:
    s = "" if value is None else str(value)
    if re.search(r'[",\n]', s):
        return '"' + s.replace('"', '""') + '"'
    return s


def to_csv(cars: list[Car]) -> str:
    headers = [
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
    ]
    lines = [",".join(headers)]
    for car in cars:
        lines.append(
            ",".join(
                csv_cell(value)
                for value in [
                    car.stock,
                    car.vin,
                    car.vehicle,
                    "" if car.age is None else int(car.age) if float(car.age).is_integer() else car.age,
                    car.bodyShop or "",
                    "" if car.photos is None else car.photos,
                    car.emissions,
                    car.key,
                    "" if car.designation is None else car.designation,
                    car.combined,
                    "YES" if car.ready else "",
                ]
            )
        )
    return "\n".join(lines)


def to_tsv(cars: list[Car]) -> str:
    header = "\t".join(["Stock #", "VIN", "Vehicle", "Photos", "Designation", "EMISSIONS& KEY CODE"])
    lines = [
        "\t".join(
            [
                car.stock,
                car.vin,
                car.vehicle,
                "" if car.photos is None else str(car.photos),
                "" if car.designation is None else str(car.designation),
                car.combined,
            ]
        )
        for car in cars
    ]
    return "\n".join([header, *lines])


def xref_filename(group: str | None = None, when: datetime | None = None) -> str:
    when = when or datetime.now()
    stamp = f"{when.month}-{when.day}-{str(when.year)[2:]}"
    clean = re.sub(r"\s+", " ", re.sub(r'[\\/:*?"<>|,]+', " ", group or "")).strip()
    return f"vauto xref {clean} {stamp}.csv" if clean else f"vauto xref {stamp}.csv"


def format_as_of(iso: str | None) -> str:
    if not iso:
        return "date unknown"
    parts = iso.split("-")
    if len(parts) != 3:
        return iso
    year, month, day = parts
    return f"{int(month)}/{int(day)}/{year[2:]}"


def load_sample() -> Books:
    path = ROOT / "data" / "roster.json"
    if not path.exists():
        return Books()
    return Books.from_json(path.read_text())


def load_body_jobs() -> tuple[list[dict], str]:
    path = ROOT / "data" / "body-list.json"
    if not path.exists():
        return [], ""
    data = json.loads(path.read_text())
    return list(data.get("jobs") or []), str(data.get("pulledAt") or "")


def parse_body_rows(rows: list[list[Any]]) -> list[dict]:
    start = 0
    shop_col = 4
    work_col = 3
    vehicle_col = 0
    if rows:
        head = " ".join(norm_header(value) for value in rows[0])
        if "description" in head or "year" in head or "vehicle" in head:
            start = 1
            headers = [norm_header(value) for value in rows[0]]
            for i, h in enumerate(headers):
                if "description" in h:
                    work_col = i
                if h in ("year make model stock", "vehicle", "year make model"):
                    vehicle_col = i
            if work_col + 1 < len(headers):
                shop_col = work_col + 1
    jobs: list[dict] = []
    seen: dict[str, dict] = {}
    for row in rows[start:]:
        vehicle = text(cell(row, vehicle_col))
        stock = stock_from_body_vehicle(vehicle)
        if not stock:
            continue
        work = text(cell(row, work_col))
        shop = shop_label(text(cell(row, shop_col)))
        prev = seen.get(stock)
        if prev and prev["work"] and prev["work"] != work:
            work = f"{prev['work']}; {work}"
        seen[stock] = {"stock": stock, "shop": shop, "work": work}
    jobs.extend(seen.values())
    return jobs


def cars_frame(cars: list[Car]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "#": mark_of(car),
                "Stock": car.stock,
                "Vehicle": car.vehicle,
                "Age": None if car.age is None else int(car.age) if float(car.age).is_integer() else car.age,
                "Body": car.bodyShop or "",
                "Photos": photo_of(car),
                "Emissions": car.emissions if car.onReport else "Not on report",
                "Keys": car.key,
                "Result": result_of(car),
            }
            for car in cars
        ]
    )


# --- spreadsheets ---


def parse_upload(name: str, data: bytes) -> dict[str, Any]:
    sheets = read_sheets(name, data)
    return parse_workbook(sheets, name)


def read_sheets(name: str, data: bytes) -> dict[str, list[list[Any]]]:
    if name.lower().endswith(".csv"):
        frame = pd.read_csv(io.BytesIO(data), header=None, dtype=object)
        book = {"Sheet1": frame}
    else:
        engine = "xlrd" if name.lower().endswith(".xls") else "openpyxl"
        book = pd.read_excel(io.BytesIO(data), sheet_name=None, header=None, dtype=object, engine=engine)
    sheets: dict[str, list[list[Any]]] = {}
    for sheet, frame in book.items():
        rows = frame.where(frame.notna(), None).values.tolist()
        if len(rows) > 8000:
            rows = rows[:8000]
        sheets[str(sheet)] = rows
    return sheets


def parse_workbook(sheets: dict[str, list[list[Any]]], filename: str) -> dict[str, Any]:
    names = list(sheets)
    revo = next((name for name in names if name.strip().lower() == "revo"), None)
    dms_name = next((name for name in names if name.strip().lower() == "dms"), None)
    if revo:
        revo_rows = sheets[revo]
        parsed = parse_sheet(revo_rows)
        dms = parsed["dms"]
        separate = parsed["separate"]
        as_of = as_of_from(filename, sheets[dms_name][:2] if dms_name else revo_rows)
        if dms_name:
            other = parse_sheet(sheets[dms_name])
            if other["dms"]:
                dms = other["dms"]
                separate = other["separate"]
                as_of = as_of_from(filename, sheets[dms_name]) or as_of
        if not parsed["vauto"] and not dms:
            return {"error": "Couldn't find stock # and VIN columns.", "name": filename}
        return {
            "vauto": parsed["vauto"],
            "dms": dms,
            "asOf": as_of or from_name(filename),
            "name": filename,
            "dmsSeparate": separate,
        }
    for name, rows in sheets.items():
        parsed = parse_sheet(rows)
        if parsed["vauto"] or parsed["dms"]:
            return {
                "vauto": parsed["vauto"],
                "dms": parsed["dms"],
                "asOf": as_of_from(filename, rows),
                "name": filename,
                "dmsSeparate": parsed["separate"],
            }
    return {"error": "Couldn't find stock # and VIN columns.", "name": filename}


def parse_sheet(rows: list[list[Any]]) -> dict[str, Any]:
    header_at = find_header(rows)
    if header_at < 0:
        return {"vauto": None, "dms": None, "separate": False}
    cols = map_columns(rows[header_at] or [])
    is_vauto = cols.get("photoCount") is not None or cols.get("photos") is not None or cols.get("yes") is not None
    is_dms = cols.get("emissions") is not None or cols.get("key") is not None or cols.get("combined") is not None
    separate = cols.get("emissions") is not None and cols.get("key") is not None
    vauto: list[VautoRow] = []
    dms: list[DmsRow] = []
    for row in rows[header_at + 1 :]:
        vin = norm_vin(cell(row, cols.get("vin")))
        if len(vin) < 11:
            continue
        stock = norm_stock(cell(row, cols.get("stock"))) or vin[-8:]
        if is_vauto:
            photos = None
            if cols.get("photoCount") is not None:
                photos = num(cell(row, cols.get("photoCount")))
            elif cols.get("photos") is not None:
                photos = num(cell(row, cols.get("photos")))
            photo_flag = None
            if cols.get("yes") is not None:
                flag = text(cell(row, cols.get("yes"))).upper()
                if flag == "YES":
                    photo_flag = True
                elif flag == "NO":
                    photo_flag = False
            vauto.append(
                VautoRow(
                    vin=vin,
                    stock=stock,
                    vehicle=text(cell(row, cols.get("vehicle"))) if cols.get("vehicle") is not None else "",
                    photos=photos,
                    photoFlag=photo_flag,
                    age=num(cell(row, cols.get("age"))) if cols.get("age") is not None else None,
                    miles=num(cell(row, cols.get("miles"))) if cols.get("miles") is not None else None,
                    price=num(cell(row, cols.get("price"))) if cols.get("price") is not None else None,
                    cost=num(cell(row, cols.get("cost"))) if cols.get("cost") is not None else None,
                    color=text(cell(row, cols.get("color"))) if cols.get("color") is not None else "",
                )
            )
        if is_dms:
            emissions, key = read_emissions_key(row, cols, separate)
            dms.append(
                DmsRow(
                    vin=vin,
                    stock=stock,
                    description=text(cell(row, cols.get("vehicle"))) if cols.get("vehicle") is not None else "",
                    emissions=emissions,
                    key=key,
                    age=num(cell(row, cols.get("age"))) if cols.get("age") is not None else None,
                    miles=num(cell(row, cols.get("miles"))) if cols.get("miles") is not None else None,
                    price=num(cell(row, cols.get("price"))) if cols.get("price") is not None else None,
                    cost=num(cell(row, cols.get("cost"))) if cols.get("cost") is not None else None,
                )
            )
    return {"vauto": vauto if is_vauto else None, "dms": dms if is_dms else None, "separate": separate}


def read_emissions_key(row: list[Any], cols: dict[str, int], separate: bool) -> tuple[str, str]:
    if not separate and cols.get("combined") is not None:
        return split_combined(text(cell(row, cols.get("combined"))))
    emissions = text(cell(row, cols.get("emissions"))) if cols.get("emissions") is not None else ""
    key = text(cell(row, cols.get("key"))) if cols.get("key") is not None else ""
    if not emissions and not key and cols.get("combined") is not None:
        return split_combined(text(cell(row, cols.get("combined"))))
    if emissions and not key and "&" in emissions:
        return split_combined(emissions)
    return emissions, key


def split_combined(raw: str) -> tuple[str, str]:
    s = raw.strip()
    if not s:
        return "", ""
    at = s.find("&")
    if at == -1:
        if re.search(r"GOOD|CHECK|SAG|BTSUNDAY|\bWS\b", s, re.I) and not DATE_RE.search(s) and not re.search(r"XMPT", s, re.I):
            return "", s
        return s, ""
    return s[:at].strip(), s[at + 1 :].strip()


def map_columns(header: list[Any]) -> dict[str, int]:
    cols: dict[str, int] = {}

    def set_col(key: str, index: int) -> None:
        cols.setdefault(key, index)

    for index, value in enumerate(header):
        h = norm_header(value)
        if not h:
            continue
        if h in ("stock #", "stock#", "stock"):
            set_col("stock", index)
        elif h == "vin":
            set_col("vin", index)
        elif h in ("vehicle", "vehicle description"):
            set_col("vehicle", index)
        elif h == "photo count":
            set_col("photoCount", index)
        elif h == "photos":
            set_col("photos", index)
        elif h == "yes":
            set_col("yes", index)
        elif h == "age":
            set_col("age", index)
        elif h in ("miles", "odometer"):
            set_col("miles", index)
        elif h in ("price", "list"):
            set_col("price", index)
        elif h == "cost":
            set_col("cost", index)
        elif h == "color":
            set_col("color", index)
        elif "emission" in h and "key" in h:
            set_col("combined", index)
        elif h in ("emissions", "emission"):
            set_col("emissions", index)
        elif h in ("key code", "keycode", "keys"):
            set_col("key", index)
    return cols


def find_header(rows: list[list[Any]]) -> int:
    for i, row in enumerate(rows[:30]):
        headers = [norm_header(value) for value in row]
        if "vin" in headers and any(h in ("stock #", "stock#", "stock") for h in headers):
            return i
    return -1


def pick_books(parts: list[dict[str, Any]], previous: Books | None = None) -> Books:
    vauto_cands: list[tuple[int, list[VautoRow], str | None, str]] = []
    dms_cands: list[tuple[int, list[DmsRow], str | None, str, bool]] = []
    for part in parts:
        if part.get("error"):
            continue
        if part.get("vauto"):
            rows = part["vauto"]
            vauto_cands.append((score_vauto(rows), rows, part.get("asOf"), part.get("name") or ""))
        if part.get("dms"):
            rows = part["dms"]
            separate = bool(part.get("dmsSeparate"))
            dms_cands.append((score_dms(rows, separate, part.get("asOf")), rows, part.get("asOf"), part.get("name") or "", separate))
    # A file just uploaded replaces that side, even when it has fewer cars.
    # The previous list only fills a side this upload did not include.
    if not vauto_cands and previous and previous.vauto:
        vauto_cands.append((score_vauto(previous.vauto), previous.vauto, previous.vautoAsOf, previous.vautoName))
    if not dms_cands and previous and previous.dms:
        dms_cands.append(
            (score_dms(previous.dms, previous.dmsSeparate, previous.dmsAsOf), previous.dms, previous.dmsAsOf, previous.dmsName, previous.dmsSeparate)
        )
    vauto_cands.sort(key=lambda item: item[0], reverse=True)
    dms_cands.sort(key=lambda item: item[0], reverse=True)
    vauto = vauto_cands[0] if vauto_cands else None
    dms = dms_cands[0] if dms_cands else None
    return Books(
        vauto=vauto[1] if vauto else [],
        dms=dms[1] if dms else [],
        vautoAsOf=vauto[2] if vauto else None,
        dmsAsOf=dms[2] if dms else None,
        vautoName=vauto[3] if vauto else "",
        dmsName=dms[3] if dms else "",
        dmsSeparate=dms[4] if dms else False,
    )


def score_vauto(rows: list[VautoRow]) -> int:
    numeric = sum(1 for row in rows if isinstance(row.photos, (int, float)))
    return numeric * 1000 + len(rows)


def score_dms(rows: list[DmsRow], separate: bool, as_of: str | None) -> int:
    date_score = int(as_of.replace("-", "")) if as_of else 0
    return (1_000_000_000 if separate else 0) + date_score * 1000 + len(rows)


def as_of_from(filename: str, rows: list[list[Any]]) -> str | None:
    banner = " ".join(" ".join("" if value is None else str(value) for value in (row or [])) for row in rows[:2])
    split = re.search(r"1\s*&?\s*0/(\d{1,2})/(\d{2})\b", banner)
    if split:
        return iso(2000 + int(split.group(2)), 10, int(split.group(1)))
    full = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b", banner)
    if full:
        year = 2000 + int(full.group(3)) if len(full.group(3)) == 2 else int(full.group(3))
        return iso(year, int(full.group(1)), int(full.group(2)))
    return from_name(filename)


def from_name(name: str) -> str | None:
    iso_match = re.search(r"(20\d{2})[-_](\d{1,2})[-_](\d{1,2})", name)
    if iso_match:
        return iso(int(iso_match.group(1)), int(iso_match.group(2)), int(iso_match.group(3)))
    us = re.search(r"(?:^|[^\d])(\d{1,2})[-_](\d{1,2})[-_](\d{2,4})(?:[^\d]|$)", name)
    if us:
        year = 2000 + int(us.group(3)) if len(us.group(3)) == 2 else int(us.group(3))
        return iso(year, int(us.group(1)), int(us.group(2)))
    return None


def iso(year: int, month: int, day: int) -> str:
    return f"{year}-{month:02d}-{day:02d}"


def cell(row: list[Any] | None, index: int | None) -> Any:
    if row is None or index is None or index >= len(row):
        return None
    return row[index]


def norm_header(value: Any) -> str:
    return re.sub(r"\s+", " ", str(display(value) or "")).strip().lower()


def norm_vin(value: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(display(value) or "").upper())


def norm_stock(value: Any) -> str:
    raw = str(display(value) or "")
    return re.sub(r"\s+", "", raw.lstrip("*").strip().upper())


def num(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if pd.isna(value):
            return None
        return float(value)
    try:
        n = float(str(value).replace("$", "").replace(",", "").replace("%", "").strip())
    except ValueError:
        return None
    return n


def text(value: Any) -> str:
    shown = display(value)
    if shown is None:
        return ""
    return re.sub(r"\s+", " ", str(shown)).strip()


def display(value: Any) -> Any:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, datetime):
        return f"{value.month}/{value.day}/{str(value.year)[2:]}"
    if isinstance(value, pd.Timestamp):
        return f"{value.month}/{value.day}/{str(value.year)[2:]}"
    return value
