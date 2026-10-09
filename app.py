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
    compare_key,
    count_cars,
    format_as_of,
    join_books,
    load_body_jobs,
    load_sample,
    matches_filter,
    matches_query,
    to_csv,
    to_tsv,
    xref_filename,
)
from xref_io import cars_frame, parse_body_rows, parse_upload, pick_books, read_sheets

ROOT = Path(__file__).resolve().parent

st.set_page_config(page_title="vAuto X-Ref", layout="wide", initial_sidebar_state="collapsed")
