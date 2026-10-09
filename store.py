"""Saved desk and archives. The file stays on disk so a restart keeps the last cross-reference."""

from __future__ import annotations

import hashlib
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from xref_engine import Books, Car, to_csv

DB_PATH = Path(__file__).resolve().parent / "data" / "xref.db"


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.executescript(
        """
        create table if not exists archives (
          id text primary key,
          saved_at text not null,
          filename text not null,
          vauto_name text not null default '',
          dms_name text not null default '',
          total integer not null,
          ready integer not null,
          csv text not null,
          books_json text not null,
          content_hash text not null unique
        );
        create table if not exists desk (
          id text primary key,
          books_json text not null,
          updated_at text not null
        );
        """
    )
    return db


def save_desk(books: Books) -> None:
    db = connect()
    db.execute(
        "insert into desk (id, books_json, updated_at) values ('current', ?, ?) "
        "on conflict(id) do update set books_json = excluded.books_json, updated_at = excluded.updated_at",
        (books.to_json(), datetime.now(timezone.utc).isoformat()),
    )
    db.commit()
    db.close()


def load_desk() -> Books | None:
    db = connect()
    row = db.execute("select books_json from desk where id = 'current'").fetchone()
    db.close()
    if not row:
        return None
    return Books.from_json(row["books_json"])


def archive_books(books: Books, cars: list[Car]) -> str | None:
    if not books.vauto or not books.dms:
        return None
    csv = to_csv(cars)
    digest = hashlib.sha256(csv.encode()).hexdigest()
    db = connect()
    existing = db.execute("select filename from archives where content_hash = ?", (digest,)).fetchone()
    if existing:
        db.close()
        return None
    now = datetime.now()
    filename = f"vauto xref {now.month}-{now.day}-{str(now.year)[2:]}.csv"
    taken = {row["filename"] for row in db.execute("select filename from archives")}
    base = filename[:-4]
    n = 2
    while filename in taken:
        filename = f"{base}-{n}.csv"
        n += 1
    ready = sum(1 for car in cars if car.ready)
    db.execute(
        "insert into archives (id, saved_at, filename, vauto_name, dms_name, total, ready, csv, books_json, content_hash) "
        "values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            f"{int(now.timestamp())}-{digest[:6]}",
            now.isoformat(),
            filename,
            books.vautoName,
            books.dmsName,
            len(cars),
            ready,
            csv,
            books.to_json(),
            digest,
        ),
    )
    db.commit()
    db.close()
    return filename


def list_archives() -> list[sqlite3.Row]:
    db = connect()
    rows = db.execute("select id, saved_at, filename, total, ready from archives order by saved_at desc limit 30").fetchall()
    db.close()
    return rows


def archive_books_json(archive_id: str) -> str | None:
    db = connect()
    row = db.execute("select books_json from archives where id = ?", (archive_id,)).fetchone()
    db.close()
    return row["books_json"] if row else None


def archive_csv(archive_id: str) -> tuple[str, str] | None:
    db = connect()
    row = db.execute("select filename, csv from archives where id = ?", (archive_id,)).fetchone()
    db.close()
    if not row:
        return None
    return row["filename"], row["csv"]
