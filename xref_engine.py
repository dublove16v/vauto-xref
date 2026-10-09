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
    return str(car.designation) if car.designation else "\u2013"


def result_of(car: Car) -> str:
    if car.ready:
        return "Trade \u00b7 Advertise" if car.trade else "Advertise"
    if car.trade:
        tail = " \u00b7 ".join(car.blockers)
        return f"Trade \u00b7 {tail}" if tail else "Trade"
    return " \u00b7 ".join(car.blockers)


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
