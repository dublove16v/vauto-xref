#!/bin/sh
set -eu
cd /workspace
if curl -sf --max-time 2 http://127.0.0.1:8080/ | grep -qi streamlit; then
  exit 0
fi
# The desk is the Streamlit app. Free 8080 if an older server is still there.
for p in /proc/[0-9]*; do
  tr "\0" " " 2>/dev/null < "$p/cmdline" | grep -Eq "[s]treamlit|[v]ite dev|[n]ode " && kill "$(basename "$p")" 2>/dev/null || true
done
sleep 1
if ! python3 -c "import streamlit,pandas,openpyxl,xlrd" 2>/dev/null; then
  pip install -q -r /workspace/requirements.txt
fi
nohup python3 -m streamlit run /workspace/app.py --server.port 8080 --server.address 0.0.0.0 --server.headless true >>/tmp/app-startup.log 2>&1 &
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  curl -sf -o /dev/null --max-time 1 http://127.0.0.1:8080/ && exit 0
  sleep 0.5
done
exit 1
