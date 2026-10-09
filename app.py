"""vAuto X-Ref — Streamlit desk for GitHub and Streamlit Community Cloud."""

from __future__ import annotations

import base64
from datetime import datetime
from pathlib import Path

import streamlit as st

import store
from xref_engine import (
    FILTERS,
    FILTER_LABEL,
    Books,
    apply_body,
    cars_frame,
    compare_key,
    count_cars,
    format_as_of,
    join_books,
    load_body_jobs,
    load_sample,
    matches_filter,
    matches_query,
    parse_body_rows,
    parse_upload,
    pick_books,
    read_sheets,
    to_csv,
    to_tsv,
    xref_filename,
)

ROOT = Path(__file__).resolve().parent

st.set_page_config(page_title="vAuto X-Ref", layout="wide", initial_sidebar_state="collapsed")


def font_bytes(name: str) -> bytes:
    otf = ROOT / "fonts" / name
    if otf.exists():
        return otf.read_bytes()
    return base64.b64decode((ROOT / "fonts" / f"{name}.b64").read_text())


def font_css() -> str:
    try:
        regular = base64.b64encode(font_bytes("CenturyGothicPro.otf")).decode()
        bold = base64.b64encode(font_bytes("CenturyGothicPro-Bold.otf")).decode()
    except OSError:
        return "<style>.stApp { background: #f3efe6; color: #1a1814; }</style>"
    return f"""
    <style>
      @font-face {{
        font-family: "Century Gothic Pro";
        src: url(data:font/otf;base64,{regular}) format("opentype");
        font-weight: 400;
        font-style: normal;
      }}
      @font-face {{
        font-family: "Century Gothic Pro";
        src: url(data:font/otf;base64,{bold}) format("opentype");
        font-weight: 700;
        font-style: normal;
      }}
      html, body, [class*="css"], .stApp, .stMarkdown, button, input, textarea, label {{
        font-family: "Century Gothic Pro", "Century Gothic", sans-serif !important;
      }}
      h1, h2, h3, strong, b, [data-testid="stMetricValue"], .stButton button {{
        font-weight: 700 !important;
      }}
      .stApp {{ background: #f3efe6; color: #1a1814; }}
      [data-testid="stSidebar"] {{ background: #fffcf7; }}
      .block-container {{ padding-top: 1.2rem; }}
      [data-testid="stFileUploaderDropzone"] {{
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: center !important;
        text-align: center !important;
      }}
      [data-testid="stFileUploaderDropzone"] > div {{
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        width: 100%;
      }}
      [data-testid="stFileUploaderDropzone"] button {{
        margin-left: auto !important;
        margin-right: auto !important;
      }}
      [data-testid="stSidebar"] [data-testid="stWidgetLabel"] {{
        display: flex !important;
        justify-content: center !important;
        width: 100%;
        text-align: center !important;
      }}
      [data-testid="stSidebar"] [data-testid="stWidgetLabel"] span {{
        width: 100%;
        text-align: center !important;
      }}
      [data-testid="stSidebar"] [data-testid="stFileUploaderDropzone"] small,
      [data-testid="stSidebar"] [data-testid="stFileUploaderDropzoneInstructions"] {{
        text-align: center !important;
        width: 100%;
      }}
      [data-testid="stSidebar"] button {{
        justify-content: center !important;
        text-align: center !important;
      }}
      @media print {{
        section[data-testid="stSidebar"], header, [data-testid="stToolbar"],
        [data-testid="stDecoration"], .stDownloadButton, .stButton, footer {{
          display: none !important;
        }}
        .stApp {{ background: white !important; }}
      }}
    </style>
    """


def ensure_state() -> None:
    if "books" not in st.session_state:
        saved = store.load_desk()
        st.session_state.books = saved if saved and saved.vauto else load_sample()
        st.session_state.using_sample = saved is None or not (saved and saved.vauto)
    st.session_state.setdefault("filter", "all")
    st.session_state.setdefault("hide_wholesale", False)
    st.session_state.setdefault("show_filters", True)
    st.session_state.setdefault("query", "")
    st.session_state.setdefault("notice", "")
    if "body_jobs" not in st.session_state:
        jobs, pulled = load_body_jobs()
        st.session_state.body_jobs = jobs
        st.session_state.body_pulled = pulled
    st.session_state.setdefault("upload_sig", "")


def ingest(files: list[tuple[str, bytes]]) -> None:
    parts = []
    errors = []
    for name, data in files:
        parsed = parse_upload(name, data)
        if parsed.get("error") and not parsed.get("vauto") and not parsed.get("dms"):
            errors.append(f"{name}: {parsed['error']}")
        else:
            parts.append(parsed)
    if not parts:
        st.session_state.notice = " ".join(errors) or "Those files did not have a stock # and VIN."
        return
    previous = st.session_state.books
    old_vins = {row.vin for row in previous.vauto}
    books = pick_books(parts, previous)
    st.session_state.books = books
    st.session_state.using_sample = False
    store.save_desk(books)
    cars = current_cars()
    saved = store.archive_books(books, cars) if books.vauto and books.dms else None
    ready = sum(1 for car in cars if car.ready)
    replaced_vauto = any(part.get("vauto") for part in parts)
    removed = len(old_vins - {row.vin for row in books.vauto}) if replaced_vauto else 0
    st.session_state.notice = (
        f"vAuto now {len(books.vauto)} cars from {books.vautoName or 'the upload'}"
        f" · {ready} to be advertised"
        + (f" · report {len(books.dms)} rows" if books.dms else "")
    )
    if replaced_vauto:
        st.session_state.notice += f" · removed {removed} not on this vAuto sheet"
    if saved:
        st.session_state.notice += f" · archived {saved}"
    if errors:
        st.session_state.notice += " " + " ".join(errors)
    st.rerun()


def current_cars():
    cars = join_books(st.session_state.books)
    apply_body(cars, st.session_state.body_jobs)
    cars.sort(key=compare_key)
    return cars


def open_saved_archive() -> None:
    picked = st.session_state.get("archive_choice") or ""
    if not picked:
        return
    raw = store.archive_books_json(picked)
    if not raw:
        return
    name = next((row["filename"] for row in store.list_archives() if row["id"] == picked), "saved list")
    st.session_state.books = Books.from_json(raw)
    st.session_state.using_sample = False
    st.session_state.notice = f"Opened {name}"


def visible_cars(cars):
    hide = st.session_state.hide_wholesale
    listed = [car for car in cars if not (hide and car.wholesale)]
    counts = count_cars(listed)
    counts["wholesale"] = sum(1 for car in cars if car.wholesale)
    filt = st.session_state.filter
    pool = cars if filt == "wholesale" else listed
    query = st.session_state.query
    rows = [car for car in pool if matches_filter(car, filt) and matches_query(car, query)]
    return rows, counts


ensure_state()
st.markdown(font_css(), unsafe_allow_html=True)

books = st.session_state.books
with st.sidebar:
    st.markdown("<h3 style='text-align:center;margin:0.2rem 0 0.6rem'>Load</h3>", unsafe_allow_html=True)
    vauto_up = st.file_uploader("vAuto inventory", type=["xlsx", "xls", "csv"], key="vauto_up")
    report_up = st.file_uploader("Report", type=["xlsx", "xls", "csv"], key="report_up")
    body_up = st.file_uploader("Body list", type=["xlsx", "xls", "csv"], key="body_up")
    if st.button("Merge uploads", type="primary", width="stretch"):
        files = []
        for upload in (vauto_up, report_up):
            if upload is not None:
                files.append((upload.name, upload.getvalue()))
        if body_up is not None:
            sheets = read_sheets(body_up.name, body_up.getvalue())
            body_rows = sheets.get("BODY") or sheets.get("Body") or next(iter(sheets.values()), [])
            st.session_state.body_jobs = parse_body_rows(body_rows)
            st.session_state.body_pulled = datetime.now().isoformat(timespec="minutes")
        if files:
            ingest(files)
        elif body_up is not None:
            st.session_state.notice = "Body list updated."
            st.rerun()
        else:
            st.session_state.notice = "Add a vAuto file, a report, or both."
    if st.button("Back to sample", width="stretch"):
        st.session_state.books = load_sample()
        st.session_state.using_sample = True
        st.session_state.notice = "Showing the sample inventory."
        st.rerun()
    st.divider()
    st.markdown("<h3 style='text-align:center;margin:0.2rem 0 0.6rem'>Archive</h3>", unsafe_allow_html=True)
    archives = store.list_archives()
    if not archives:
        st.markdown(
            "<p style='text-align:center;color:#6b645c;font-size:0.85rem'>A merged inventory and report is saved here automatically.</p>",
            unsafe_allow_html=True,
        )
    else:
        labels = {row["id"]: f"{row['filename']} · {row['ready']} to advertise" for row in archives}
        st.selectbox(
            "Archive",
            options=[""] + list(labels),
            format_func=lambda archive_id: "Choose a saved list" if not archive_id else labels[archive_id],
            label_visibility="collapsed",
            key="archive_choice",
            on_change=open_saved_archive,
        )

sample_bit = "Sample · " if st.session_state.using_sample else ""
st.markdown(
    "<h1 style='text-align:center'>vAuto <span style='color:#c4531a'>X-Ref</span></h1>",
    unsafe_allow_html=True,
)
st.markdown(
    "<p style='text-align:center;margin-top:-0.75rem'>"
    f"{sample_bit}vAuto {format_as_of(books.vautoAsOf)} · Report {format_as_of(books.dmsAsOf)}"
    + (f" · Body list {st.session_state.body_pulled[:10]}" if st.session_state.body_pulled else "")
    + "</p>",
    unsafe_allow_html=True,
)
if not books.vauto:
    st.info("Open the side panel, upload the vAuto inventory and the report, then Merge uploads.")
if st.session_state.notice:
    st.success(st.session_state.notice)

cars = current_cars()
shown, counts = visible_cars(cars)
group = "All cars" if st.session_state.filter == "all" else FILTER_LABEL.get(st.session_state.filter, "All cars")
query = st.session_state.query.strip()
group_title = f"{group} · {query}" if query else group

left, right = st.columns([3, 2])
with left:
    st.session_state.query = st.text_input("Search stock, VIN, or vehicle", value=st.session_state.query, label_visibility="collapsed", placeholder="Stock, VIN, vehicle, sticker")
with right:
    c1, c2, c3 = st.columns(3)
    with c1:
        if st.button("Hide filters" if st.session_state.show_filters else "Show filters", width="stretch"):
            st.session_state.show_filters = not st.session_state.show_filters
            st.rerun()
    with c2:
        wholesale_label = "Wholesale hidden" if st.session_state.hide_wholesale else "Hide wholesale"
        if st.button(f"{wholesale_label} ({counts['wholesale']})", width="stretch"):
            st.session_state.hide_wholesale = not st.session_state.hide_wholesale
            st.rerun()
    with c3:
        st.markdown(
            '<button onclick="window.print()" style="height:2.4rem;width:100%;border:1px solid #d9d1c3;border-radius:8px;background:#fffcf7;font-weight:700;cursor:pointer;">Print</button>',
            unsafe_allow_html=True,
        )

st.caption(f"**{group}** · {len(shown)} on this list")

if st.session_state.show_filters:
    for start in range(0, len(FILTERS), 4):
        cols = st.columns(4)
        for col, (fid, label, hint) in zip(cols, FILTERS[start : start + 4]):
            with col:
                active = st.session_state.filter == fid
                if st.button(
                    f"{counts[fid]}  {label}",
                    key=f"filter-{fid}",
                    width="stretch",
                    type="primary" if active else "secondary",
                    help=hint,
                ):
                    st.session_state.filter = "all" if active else fid
                    st.rerun()

frame = cars_frame(shown)
st.markdown(f"<div class='print-only'><h2>{group_title}</h2><p>{len(shown)} cars · {datetime.now():%B %-d, %Y}</p></div>", unsafe_allow_html=True)
st.dataframe(frame, width="stretch", hide_index=True, height=640)

d1, d2, d3 = st.columns(3)
with d1:
    st.download_button(
        "Export this group",
        data=to_csv(shown).encode(),
        file_name=xref_filename(group_title),
        mime="text/csv",
        width="stretch",
    )
with d2:
    ready = [car for car in cars if car.ready and not (st.session_state.hide_wholesale and car.wholesale)]
    st.download_button(
        "Export to advertise",
        data=to_tsv(ready).encode(),
        file_name=xref_filename("To Be Advertised").replace(".csv", ".tsv"),
        mime="text/tab-separated-values",
        width="stretch",
    )
with d3:
    st.caption("To be advertised when there are photos, emissions is a date or XMPT, and the keys are a 3 or 4.")

if not books.dms:
    st.warning("No report loaded. Emissions and key codes are what make a 3 or 4 eligible.")
