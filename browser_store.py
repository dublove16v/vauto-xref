"""Browser copy of the archive. A Streamlit rebuild does not touch localStorage."""

from __future__ import annotations

from pathlib import Path

import streamlit.components.v1 as components

_store = components.declare_component("browser_store", path=str(Path(__file__).parent / "browser_store"))

KEY = "vauto-xref-browser-v1"


def browser_store(payload: str | None = None) -> str | None:
    value = _store(storeKey=KEY, payload=payload, height=0, default=None, key="vauto_browser_store")
    if value is None:
        return None
    return str(value)
