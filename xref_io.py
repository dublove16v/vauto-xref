"""Spreadsheet reading and the body-list parser for vAuto X-Ref."""

from __future__ import annotations

import io
import re
from datetime import datetime
from typing import Any

import pandas as pd

from xref_engine import (
    Books,
    DmsRow,
    VautoRow,
    mark_of,
    photo_of,
    result_of,
    shop_label,
    stock_from_body_vehicle,
    stock_key,
)


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
    return list(seen.values())


def cars_frame(cars):
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
        if re.search(r"GOOD|CHECK|SAG|BTSUNDAY|\bWS\b", s, re.I) and not re.search(r"\d{1,2}/\d{1,2}/\d{2,4}|\d{1,2}-\d{1,2}-\d{2,4}", s) and not re.search(r"XMPT", s, re.I):
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
    vauto_cands = []
    dms_cands = []
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


def cell(row, index):
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


def num(value: Any):
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


def display(value: Any):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, datetime):
        return f"{value.month}/{value.day}/{str(value.year)[2:]}"
    if isinstance(value, pd.Timestamp):
        return f"{value.month}/{value.day}/{str(value.year)[2:]}"
    return value
