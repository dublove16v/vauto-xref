# vAuto X-Ref

Cross-reference a vAuto used inventory with the DMS report. Cars sort oldest first. A car is **to be advertised** when it has photos, emissions is a date or XMPT, and the key designation is 3 or 4.

## Run it

```bash
pip install -r requirements.txt
streamlit run app.py
```

## Streamlit Community Cloud

1. In Streamlit, create an app from this repo. The main file is `app.py`.
2. The sample inventory loads until you upload a vAuto file and a report. A merged pair is archived on disk for the next visit.

## What to upload

- **vAuto inventory** — the used inventory workbook (the sheet with Photo Count).
- **Report** — the DMS report. Separate emissions and key columns are combined into one field.
- **Body list** — optional. The BODY tab of BODY LIST 2.0. A stock on that tab is marked in the Body column (Ruiz, Master, Robb, or Body).

Wholesale is anything whose key, emissions, vehicle, or stock says WS. Stock numbers ending in T, P, TL, or PL are trades. A designation of 1 with no emissions stays a normal row and can be filtered as Awaiting Transport.

Pick a filter, then **Export this group** or **Print**. The file name looks like `vauto xref To Be Advertised 10-8-26.csv`.
