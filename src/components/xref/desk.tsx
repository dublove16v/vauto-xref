import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Check, Copy, Download, Menu, Minus, Printer, Search, Upload, X } from "lucide-react";
import rosterJson from "@/data/roster.json";
import bodySeed from "@/data/body-list.json";
import { bodyIndex, type BodyJob } from "@/lib/xref/body";
import {
  archiveBooks,
  downloadCsv,
  forgetArchive,
  formatSavedAt,
  listArchives,
  readDesk,
  writeDesk,
  xrefFilename,
  type ArchiveEntry,
} from "@/lib/xref/archive";
import { loadBodyJobs, loadXrefStore, removeXrefArchive, syncXrefStore } from "@/lib/xref/store";
import {
  compareCars,
  countCars,
  formatAsOf,
  formatMiles,
  formatMoney,
  joinBooks,
  matchesFilter,
  matchesQuery,
  parseFile,
  pickBooks,
  toCsv,
  toTsv,
  type Books,
  type Car,
  type FilterId,
  type Parsed,
} from "@/lib/xref/model";

const HIDE_WS_KEY = "vauto-xref-hide-wholesale";
const SHOW_FILTERS_KEY = "vauto-xref-show-filters";
const sample = rosterJson as Books;

const FILTERS: { id: FilterId; label: string; hint: string }[] = [
  { id: "ready", label: "To Be Advertised", hint: "Photos, emissions, and a 3 or 4" },
  { id: "photos", label: "Has Photos", hint: "Photo count is above zero" },
  { id: "nophotos", label: "No Photos", hint: "Photo count is zero" },
  { id: "needsphotos", label: "No Photos, Has Emissions", hint: "A date or XMPT, and no photos" },
  { id: "highnophotos", label: "Has Emissions, 3 or 4, No Photos", hint: "A date or XMPT, a 3 or 4, and no photos" },
  { id: "through", label: "Through Emissions", hint: "Emissions is a date or XMPT" },
  { id: "needs", label: "Needs Emissions", hint: "On the report, with no date or XMPT" },
  { id: "des1", label: "Vehicle Status 1", hint: "Designation is 1" },
  { id: "des2", label: "Vehicle Status 2", hint: "Designation is 2" },
  { id: "high", label: "Vehicle Status 3 or 4", hint: "Designation is 3 or 4" },
  { id: "awaiting", label: "Awaiting Transport", hint: "A 1 with no emissions" },
  { id: "wholesale", label: "Wholesale", hint: "Key code says WS" },
  { id: "trade", label: "Trade", hint: "Stock ends in T, P, TL, or PL" },
  { id: "body", label: "On Body List", hint: "On BODY LIST 2.0" },
  { id: "close", label: "Close", hint: "A 3 or 4 that is not ready to advertise yet" },
  { id: "offreport", label: "Not on Report", hint: "On vAuto, missing from the report" },
];

export function Desk() {
  const [books, setBooks] = useState<Books>(sample);
  const [usingSample, setUsingSample] = useState(true);
  const [filter, setFilter] = useState<FilterId>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [loadOpen, setLoadOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [storeReady, setStoreReady] = useState(false);
  const [kept, setKept] = useState<"" | "app" | "browser">("");
  const [hideWholesale, setHideWholesale] = useState(false);
  const [filtersShown, setFiltersShown] = useState(true);
  const [jobs, setJobs] = useState<BodyJob[]>(() => (bodySeed.jobs as BodyJob[]) ?? []);
  const searchRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const timer = useRef<number | null>(null);

  const cars = useMemo(() => {
    const index = bodyIndex(jobs);
    return joinBooks(books)
      .map((car) => {
        const job = index.get(car.stock.replace(/[^a-z0-9]/gi, "").toUpperCase());
        return job ? { ...car, bodyShop: job.shop, bodyWork: job.work } : car;
      })
      .sort(compareCars);
  }, [books, jobs]);
  const listed = useMemo(
    () => (hideWholesale ? cars.filter((car) => !car.wholesale) : cars),
    [cars, hideWholesale],
  );
  const counts = useMemo(() => {
    const next = countCars(listed);
    next.wholesale = cars.filter((car) => car.wholesale).length;
    return next;
  }, [listed, cars]);
  const wholesaleCount = counts.wholesale;
  const visible = useMemo(() => {
    const pool = filter === "wholesale" ? cars : listed;
    return pool.filter((car) => matchesFilter(car, filter) && matchesQuery(car, query));
  }, [cars, listed, filter, query]);
  const selectedCar = (filter === "wholesale" ? cars : listed).find((car) => car.vin === selected) ?? null;

  useEffect(() => {
    try {
      if (localStorage.getItem(HIDE_WS_KEY) === "1") setHideWholesale(true);
      if (localStorage.getItem(SHOW_FILTERS_KEY) === "0") setFiltersShown(false);
    } catch {
      /* this browser is blocking storage */
    }
  }, []);

  useEffect(() => {
    let cancel = false;
    void loadBodyJobs()
      .then((feed) => {
        if (!cancel && feed.jobs.length) setJobs(feed.jobs);
      })
      .catch(() => {
        /* the saved list still marks the rows */
      });
    return () => {
      cancel = true;
    };
  }, []);

  function toggleFilters() {
    setFiltersShown((on) => {
      const next = !on;
      try {
        localStorage.setItem(SHOW_FILTERS_KEY, next ? "1" : "0");
      } catch {
        /* preference stays for this visit */
      }
      return next;
    });
  }

  function toggleWholesale() {
    setHideWholesale((on) => {
      const next = !on;
      try {
        localStorage.setItem(HIDE_WS_KEY, next ? "1" : "0");
      } catch {
        /* preference stays for this visit */
      }
      return next;
    });
  }

  useEffect(() => {
    let cancel = false;
    const localDesk = readDesk();
    const localArchives = listArchives();
    if (localDesk) {
      setBooks(localDesk.books);
      setUsingSample(false);
    }
    setArchives(localArchives);
    setStoreReady(true);
    void (async () => {
      try {
        const remote = await loadXrefStore();
        if (cancel) return;
        const known = new Set(remote.archives.flatMap((entry) => [entry.id, entry.csv]));
        const missing = localArchives.filter((entry) => !known.has(entry.id) && !known.has(entry.csv));
        const localAt = localDesk?.savedAt ?? null;
        const remoteAt = remote.deskSavedAt;
        const pushDesk =
          localDesk != null &&
          (!remote.desk || (localAt != null && (remoteAt == null || localAt > remoteAt)));
        let next = remote;
        if (missing.length || pushDesk) {
          next = await syncXrefStore({
            data: {
              archives: missing,
              desk: pushDesk ? localDesk.books : null,
              deskSavedAt: pushDesk ? (localAt ?? new Date().toISOString()) : null,
            },
          });
          if (!cancel) flash("Saved your last cross-reference");
        }
        if (cancel) return;
        if (next.desk) {
          setBooks(next.desk);
          setUsingSample(false);
          writeDesk({ books: next.desk, usingSample: false, savedAt: next.deskSavedAt });
        }
        if (next.archives.length || remote.archives.length) setArchives(next.archives);
        if (next.desk || next.archives.length) setKept("app");
      } catch {
        if (!cancel && (localDesk || localArchives.length)) setKept("browser");
      }
    })();
    return () => {
      cancel = true;
    };
    // The saved copy is loaded once, then merges write through on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!storeReady) return;
    writeDesk({ books, usingSample });
  }, [books, usingSample, storeReady]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelected(null);
        setLoadOpen(false);
        setArchiveOpen(false);
      }
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function flash(message: string) {
    setNotice(message);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(""), 2400);
  }

  async function ingest(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setLoadError("");
    const parts: Parsed[] = [];
    const errors: string[] = [];
    for (const file of files) {
      try {
        const parsed = await parseFile(file);
        if (parsed.error || (!parsed.vauto && !parsed.dms)) {
          errors.push(`${file.name}: ${parsed.error ?? "no inventory table found"}`);
        } else {
          parts.push(parsed);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "could not read file";
        errors.push(`${file.name}: ${message}`);
      }
    }
    if (parts.length) {
      const next = pickBooks(parts, books);
      const savedAt = new Date().toISOString();
      setBooks(next);
      setUsingSample(false);
      setLoadOpen(false);
      writeDesk({ books: next, usingSample: false, savedAt });
      const archived = next.vauto.length && next.dms.length ? archiveBooks(next) : null;
      setArchives(listArchives());
      const loaded = parts.map((part) => part.name).join(", ");
      const merged = next.vauto.length > 0 && next.dms.length > 0;
      if (!merged) {
        flash(`Loaded ${loaded}`);
      } else {
        try {
          const remote = await syncXrefStore({
            data: {
              archives: archived ? [archived] : [],
              desk: next,
              deskSavedAt: savedAt,
            },
          });
          setArchives(remote.archives.length ? remote.archives : listArchives());
          setKept("app");
          flash(archived ? `Saved ${archived.filename}` : `Loaded ${loaded}`);
        } catch {
          setKept("browser");
          flash(archived ? `Saved ${archived.filename} on this computer only` : `Loaded ${loaded}`);
        }
      }
    }
    setLoadError(errors.join(" "));
    setBusy(false);
  }

  const groupLabel = filter === "all" ? "All cars" : (FILTERS.find((item) => item.id === filter)?.label ?? "All cars");
  const groupTitle = query.trim() ? `${groupLabel} · ${query.trim()}` : groupLabel;

  function exportView() {
    downloadCsv(xrefFilename(new Date(), groupTitle), toCsv(visible));
  }

  function printView() {
    window.print();
  }

  async function copyHighlighted() {
    const ready = cars.filter((car) => car.ready);
    await navigator.clipboard.writeText(toTsv(ready));
    flash(`Copied ${ready.length} to advertise`);
  }

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-paper text-ink"
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const files = [...event.dataTransfer.files];
        void ingest(files);
      }}
    >
      <header className="no-print relative flex items-center justify-end gap-3 border-b border-line bg-card px-4 py-3 md:px-6">
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-24 text-center sm:px-40">
          <div className="flex items-baseline justify-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">
              vAuto <span className="text-copper">X-Ref</span>
            </h1>
            <p className="hidden text-sm text-ink-soft sm:block">Better Way Wholesale</p>
          </div>
          <p className="max-w-full truncate text-xs text-ink-soft">
            {usingSample ? "Sample · " : ""}
            vAuto {formatAsOf(books.vautoAsOf)} · Report {formatAsOf(books.dmsAsOf)}
            {kept === "app" ? " · Saved" : kept === "browser" ? " · This computer only" : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setLoadOpen(true)}
            className="inline-flex h-11 items-center gap-2 rounded-md bg-copper-deep px-3 text-sm font-medium text-copper-ink"
          >
            <Upload className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Load files</span>
            <span className="sm:hidden">Load</span>
          </button>
          <button
            type="button"
            onClick={() => setArchiveOpen(true)}
            className="inline-flex h-11 items-center gap-2 rounded-md border border-line bg-card px-3 text-sm font-medium"
            aria-label={archives.length ? `Archive, ${archives.length} saved` : "Archive"}
          >
            <Archive className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Archive</span>
            {archives.length ? <span className="font-mono text-xs tabular-nums">{archives.length}</span> : null}
          </button>
          <button
            type="button"
            onClick={exportView}
            className="inline-flex h-11 items-center gap-2 rounded-md border border-line bg-card px-3 text-sm font-medium"
          >
            <Download className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </header>

      <div className="no-print border-b border-line px-4 py-3 md:px-6">
        <div className="md:hidden">
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="mobile-filters"
            onClick={() => setFiltersOpen((open) => !open)}
            className={
              "flex h-11 w-full items-center gap-2 rounded-md border px-3 text-left text-sm font-medium " +
              (filtersOpen || filter !== "all" ? "border-copper bg-highlight" : "border-line bg-card")
            }
          >
            <Menu className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">
              {filter === "all" ? "Filters" : FILTERS.find((item) => item.id === filter)?.label}
            </span>
            <span className="font-mono text-xs tabular-nums">{filter === "all" ? counts.all : counts[filter]}</span>
          </button>
          {filtersOpen ? (
            <div id="mobile-filters" className="mt-2 max-h-[70vh] overflow-auto rounded-md border border-line bg-card">
              <button
                type="button"
                onClick={() => {
                  setFilter("all");
                  setFiltersOpen(false);
                }}
                className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-line px-3 py-2 text-left text-sm"
              >
                <span>All cars</span>
                <span className="font-mono text-xs tabular-nums">{counts.all}</span>
              </button>
              {FILTERS.map((item) => {
                const active = filter === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setFilter(active ? "all" : item.id);
                      setFiltersOpen(false);
                    }}
                    className={
                      "flex min-h-11 w-full items-center justify-between gap-3 border-b border-line px-3 py-2 text-left last:border-b-0 " +
                      (active ? "bg-highlight" : "")
                    }
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{item.label}</span>
                      <span className="block text-xs text-ink-soft">{item.hint}</span>
                    </span>
                    <span className="font-mono text-sm tabular-nums">{counts[item.id]}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <div
          className={
            "grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6 " + (filtersShown ? "hidden md:grid" : "hidden")
          }
        >
          {FILTERS.map((item) => {
            const active = filter === item.id;
            const value = counts[item.id];
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(active ? "all" : item.id)}
                className={
                  "min-h-11 rounded-md border px-3 py-2 text-left " +
                  (active ? "border-copper bg-highlight" : "border-line bg-card")
                }
              >
                <div className="font-mono text-2xl font-semibold leading-none tabular-nums">{value}</div>
                <div className="mt-1 text-xs font-medium leading-snug">{item.label}</div>
                <div className="text-xs text-ink-soft">{item.hint}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="no-print flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 md:px-6">
        <label className="relative block min-w-0 flex-1 basis-56">
          <span className="sr-only">Search stock, VIN, or vehicle</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Stock, VIN, vehicle, sticker"
            className="h-11 w-full rounded-md border border-line bg-card pr-3 pl-9 text-sm outline-none"
          />
        </label>
        <p className="text-sm text-ink-soft">
          <span className="font-medium text-ink">{groupLabel}</span>
          {" · "}
          <span className="font-mono tabular-nums">{visible.length}</span> on this list
        </p>
        <button
          type="button"
          aria-pressed={filtersShown}
          onClick={toggleFilters}
          className="hidden h-11 items-center rounded-md border border-line bg-card px-3 text-sm md:inline-flex"
        >
          {filtersShown ? "Hide filters" : "Show filters"}
        </button>
        <button
          type="button"
          aria-pressed={hideWholesale}
          onClick={toggleWholesale}
          className={
            "inline-flex h-11 items-center gap-2 rounded-md border px-3 text-sm " +
            (hideWholesale ? "border-copper bg-highlight" : "border-line bg-card")
          }
        >
          {hideWholesale ? "Wholesale hidden" : "Hide wholesale"}
          <span className="font-mono text-xs tabular-nums">{wholesaleCount}</span>
        </button>
        <button type="button" onClick={printView} className="inline-flex h-11 items-center gap-2 rounded-md border border-line bg-card px-3 text-sm font-medium">
          <Printer className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Print</span>
        </button>
        <button type="button" onClick={() => void copyHighlighted()} className="h-11 rounded-md border border-line bg-card px-3 text-sm">
          Copy to advertise
        </button>
        {notice ? (
          <p className="text-sm text-ok" role="status">
            {notice}
          </p>
        ) : (
          <p className="hidden text-sm text-ink-soft lg:block">
            To be advertised when there are photos, emissions is a date or XMPT, and the keys are a 3 or 4.
          </p>
        )}
      </div>

      {!books.dms.length ? (
        <p className="no-print bg-warn-bg px-4 py-2 text-sm text-warn md:px-6">
          No report loaded. Emissions and key codes are what make a 3 or 4 eligible.
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <div className="print-only px-4 pt-2 pb-3">
            <p className="text-xs">vAuto X-Ref</p>
            <h2 className="text-xl font-bold">{groupTitle}</h2>
            <p className="text-sm">
              {visible.length} cars · {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>
          {visible.length === 0 ? (
            <p className="px-4 py-10 text-sm text-ink-soft md:px-6">Nothing in this cut. Clear the search or the filter.</p>
          ) : (
            <>
              <ul className="no-print divide-y divide-line md:hidden">
                {visible.map((car) => (
                  <li key={car.vin}>
                    <button
                      type="button"
                      onClick={() => setSelected(car.vin)}
                      className={
                        "flex w-full flex-col gap-2 px-4 py-3 text-left " +
                        (car.ready ? "bg-highlight" : "bg-card")
                      }
                    >
                      <CarSummary car={car} />
                    </button>
                  </li>
                ))}
              </ul>
              <table className="print-table hidden w-full table-fixed border-collapse text-sm md:table">
                <caption className="sr-only">vAuto cars scored for photos, emissions, and key designation</caption>
                <colgroup>
                  <col className="w-12" />
                  <col className="w-36" />
                  <col />
                  <col className="w-12" />
                  <col className="w-16" />
                  <col className="w-16" />
                  <col className="w-36" />
                  <col className="w-36" />
                  <col className="w-40" />
                </colgroup>
                <thead>
                  <tr className="text-left text-xs text-ink-soft">
                    <th className="px-2 py-2 font-medium">#</th>
                    <th className="px-2 py-2 font-medium">Stock</th>
                    <th className="px-2 py-2 font-medium">Vehicle</th>
                    <th className="px-2 py-2 font-medium">Age</th>
                    <th className="px-2 py-2 font-medium" title="From BODY LIST 2.0">
                      Body
                    </th>
                    <th className="px-2 py-2 font-medium">Photos</th>
                    <th className="px-2 py-2 font-medium">Emissions</th>
                    <th className="px-2 py-2 font-medium">Keys</th>
                    <th className="px-2 py-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((car) => (
                    <tr
                      key={car.vin}
                      tabIndex={0}
                      aria-selected={selected === car.vin}
                      onClick={() => setSelected(car.vin)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") setSelected(car.vin);
                      }}
                      className={
                        "cursor-pointer border-t border-line " +
                        (car.ready ? "row-ready " : "") +
                        (selected === car.vin ? "row-on" : "")
                      }
                    >
                      <td className="px-2 py-2">
                        <Badge car={car} />
                      </td>
                      <td className="truncate px-2 py-2 font-mono text-xs" title={car.trade ? `${car.stock} · Trade` : car.stock}>
                        {car.stock}
                        {car.trade ? <span className="ml-1 font-sans font-medium text-copper-deep">Trade</span> : null}
                      </td>
                      <td className="truncate px-2 py-2" title={car.vehicle}>
                        {car.vehicle}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs tabular-nums">{car.age ?? "—"}</td>
                      <td className="truncate px-2 py-2 text-xs font-bold" title={car.bodyWork || undefined}>
                        {car.bodyShop ?? "—"}
                      </td>
                      <td className="px-2 py-2">
                        <PhotoLabel car={car} />
                      </td>
                      <td className="px-2 py-2">
                        <EmissionsLabel car={car} />
                      </td>
                      <td className="px-2 py-2">
                        <KeyLabel car={car} />
                      </td>
                      <td className="truncate px-2 py-2">
                        <ResultLabel car={car} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
        {selectedCar ? (
          <aside className="no-print hidden w-96 shrink-0 overflow-auto border-l border-line bg-card lg:block">
            <CarPanel car={selectedCar} onClose={() => setSelected(null)} onCopied={flash} />
          </aside>
        ) : null}
      </div>

      {selectedCar ? (
        <div className="no-print fixed inset-0 z-30 flex flex-col bg-card lg:hidden">
          <CarPanel car={selectedCar} onClose={() => setSelected(null)} onCopied={flash} />
        </div>
      ) : null}

      {loadOpen ? (
        <LoadDialog
          busy={busy}
          error={loadError}
          onClose={() => setLoadOpen(false)}
          onFiles={(files) => void ingest(files)}
          onSample={() => {
            setBooks(sample);
            setUsingSample(true);
            setLoadOpen(false);
            setLoadError("");
            flash("Back on the Oct 5 sample");
          }}
        />
      ) : null}

      {archiveOpen ? (
        <ArchiveDialog
          entries={archives}
          onClose={() => setArchiveOpen(false)}
          onDownload={(entry) => downloadCsv(entry.filename, entry.csv)}
          onOpen={(entry) => {
            if (!entry.books) return;
            const savedAt = new Date().toISOString();
            setBooks(entry.books);
            setUsingSample(false);
            writeDesk({ books: entry.books, usingSample: false, savedAt });
            setFilter("all");
            setQuery("");
            setSelected(null);
            setArchiveOpen(false);
            void syncXrefStore({ data: { archives: [], desk: entry.books, deskSavedAt: savedAt } })
              .then(() => setKept("app"))
              .catch(() => setKept("browser"));
            flash(`Opened ${entry.filename}`);
          }}
          onRemove={(id) => {
            void (async () => {
              try {
                const next = await removeXrefArchive({ data: id });
                forgetArchive(id);
                setArchives(next.archives);
                setKept("app");
              } catch {
                flash("That copy is still saved");
              }
            })();
          }}
        />
      ) : null}

      {dragging ? (
        <div className="no-print pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-ink/40">
          <p className="rounded-md bg-card px-6 py-4 text-lg font-medium">Drop vAuto and the report</p>
        </div>
      ) : null}
    </div>
  );
}

function Badge({ car }: { car: Car }) {
  const mark = car.wholesale ? "WS" : (car.designation ?? "–");
  return (
    <span
      className={
        "inline-flex h-8 min-w-8 items-center justify-center rounded-sm px-1 font-bold " +
        (mark === "WS" ? "text-xs " : "text-sm ") +
        (car.ready
          ? "bg-copper-deep text-copper-ink"
          : car.highDes
            ? "bg-highlight text-copper-deep"
            : car.wholesale
              ? "bg-paper-2 text-ink"
              : "bg-paper-2 text-ink-soft")
      }
    >
      {mark}
    </span>
  );
}

function PhotoLabel({ car }: { car: Car }) {
  if (car.hasPhotos) {
    return <span className="font-medium tabular-nums">{car.photos != null && car.photos > 0 ? car.photos : "Yes"}</span>;
  }
  return <span className="text-bad">None</span>;
}

function EmissionsLabel({ car }: { car: Car }) {
  const tone =
    car.emissionsKind === "xmpt"
      ? "font-medium text-ok"
      : car.emissionsKind === "date"
        ? "text-ink"
        : car.emissionsKind === "note"
          ? "text-warn"
          : "text-bad";
  return (
    <span className={"block truncate font-mono text-xs " + tone} title={car.emissions || "Missing"}>
      {car.onReport ? car.emissions || "Missing" : "—"}
    </span>
  );
}

function KeyLabel({ car }: { car: Car }) {
  return (
    <span className="block truncate font-mono text-xs" title={car.key}>
      {car.onReport ? car.key || "Missing" : "—"}
      {car.keyState === "CHECK" ? <span className="text-warn"> · check</span> : null}
    </span>
  );
}

function ResultLabel({ car }: { car: Car }) {
  if (car.ready) {
    return <span className="font-medium text-copper-deep">{car.trade ? "Trade · Advertise" : "Advertise"}</span>;
  }
  if (car.trade) {
    return (
      <span className="text-xs text-ink-soft">
        <span className="font-medium text-ink">Trade</span>
        {car.blockers.length ? ` · ${car.blockers.join(" · ")}` : ""}
      </span>
    );
  }
  return <span className="text-xs text-ink-soft">{car.blockers.join(" · ")}</span>;
}

function CarSummary({ car }: { car: Car }) {
  return (
    <>
      <div className="flex items-center gap-3">
        <Badge car={car} />
        <div className="min-w-0">
          <p className="font-mono text-xs">{car.stock}{car.trade ? " · Trade" : ""}</p>
          <p className="truncate text-sm font-medium">{car.vehicle}</p>
          {car.bodyShop ? <p className="text-xs font-bold">{car.bodyShop}</p> : null}
        </div>
      </div>
      <p className="font-mono text-xs text-ink-soft">
        {car.hasPhotos ? `${car.photos && car.photos > 0 ? car.photos : "Yes"} photos` : "No photos"}
        {" · "}
        {car.onReport ? car.emissions || "No sticker" : "Not on report"}
        {" · "}
        {car.key || "No keys"}
      </p>
      <ResultLabel car={car} />
    </>
  );
}

function CarPanel({
  car,
  onClose,
  onCopied,
}: {
  car: Car;
  onClose: () => void;
  onCopied: (message: string) => void;
}) {
  async function copyCombined() {
    await navigator.clipboard.writeText(car.combined);
    onCopied("Copied combined column");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-ink-soft">{car.stock}{car.trade ? " · Trade" : ""}</p>
          <h2 className="text-lg font-semibold leading-snug">{car.vehicle}</h2>
        </div>
        <button type="button" onClick={onClose} className="inline-flex size-11 items-center justify-center rounded-md border border-line" aria-label="Close">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-col gap-4 overflow-auto px-4 py-4">
        <p className={car.ready ? "text-sm font-medium text-copper-deep" : "text-sm text-ink-soft"}>
          {car.trade ? "Trade. " : ""}
          {car.ready ? "Advertise this car." : car.blockers.join(" · ")}
        </p>
        <ul className="flex flex-col gap-2">
          <CheckRow ok={car.hasPhotos} label="Photos" detail={car.hasPhotos ? (car.photos && car.photos > 0 ? String(car.photos) : "Yes") : "None"} />
          <CheckRow
            ok={car.through}
            label="Emissions"
            detail={car.onReport ? car.emissions || "Missing" : "Not on the report"}
          />
          <CheckRow
            ok={car.highDes}
            label="Designation"
            detail={car.designation ? `${car.designation}${car.keyState === "CHECK" ? " · check" : car.keyState === "GOOD" ? " · good" : ""}` : "None"}
          />
        </ul>
        {car.bodyShop ? (
          <p className="text-sm">
            <span className="font-bold">{car.bodyShop}</span>
            {car.bodyWork ? ` · ${car.bodyWork}` : ""}
          </p>
        ) : null}
        <div className="rounded-md border border-line bg-paper p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-ink-soft">EMISSIONS & KEY CODE</p>
            <button type="button" onClick={() => void copyCombined()} className="inline-flex h-11 items-center gap-1 text-sm font-medium text-copper-deep" disabled={!car.combined}>
              <Copy className="size-4" aria-hidden="true" />
              Copy
            </button>
          </div>
          <p className="mt-2 font-mono text-sm break-all">{car.combined || "—"}</p>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Fact label="Age" value={car.age == null ? "—" : String(car.age)} />
          <Fact label="Miles" value={formatMiles(car.miles)} />
          <Fact label="vAuto price" value={formatMoney(car.price)} />
          <Fact label="Report list" value={formatMoney(car.listPrice)} />
          <Fact label="Color" value={car.color || "—"} />
          <Fact label="VIN" value={car.vin} mono />
        </dl>
        <div>
          <p className="text-xs text-ink-soft">Report description</p>
          <p className="text-sm">{car.onReport ? car.dmsDescription || "—" : "This VIN is not on the loaded report."}</p>
        </div>
      </div>
    </div>
  );
}

function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 rounded-md border border-line px-3 py-2">
      <span
        className={
          "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-sm " +
          (ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad")
        }
        aria-hidden="true"
      >
        {ok ? <Check className="size-4" /> : <Minus className="size-4" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block font-mono text-xs break-all text-ink-soft">{detail}</span>
      </span>
    </li>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className={"truncate " + (mono ? "font-mono text-xs" : "text-sm")}>{value}</dd>
    </div>
  );
}

function ArchiveDialog({
  entries,
  onClose,
  onDownload,
  onOpen,
  onRemove,
}: {
  entries: ArchiveEntry[];
  onClose: () => void;
  onDownload: (entry: ArchiveEntry) => void;
  onOpen: (entry: ArchiveEntry) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="archive-title">
      <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-md border border-line bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id="archive-title" className="text-lg font-semibold">
            Archive
          </h2>
          <button type="button" onClick={onClose} className="inline-flex size-11 items-center justify-center rounded-md border border-line" aria-label="Close">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-2 text-sm text-ink-soft">
          Saved with the app after each merge, named vauto xref plus the date. A republish keeps this list. Download one if you forgot to export.
        </p>
        {entries.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-line bg-paper px-4 py-6 text-sm text-ink-soft">
            Nothing saved yet. Load the vAuto master and the report, and the full list is kept here.
          </p>
        ) : (
          <ul className="mt-4 min-h-0 flex-1 space-y-2 overflow-auto">
            {entries.map((entry) => (
              <li key={entry.id} className="rounded-md border border-line px-3 py-3">
                <p className="truncate font-medium" title={entry.filename}>
                  {entry.filename}
                </p>
                <p className="mt-1 text-xs text-ink-soft">
                  {formatSavedAt(entry.savedAt)} · {entry.ready} to advertise · {entry.total} cars
                </p>
                <p className="truncate text-xs text-ink-soft" title={`${entry.vautoName} + ${entry.dmsName}`}>
                  {entry.vautoName || "vAuto"} + {entry.dmsName || "report"}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onDownload(entry)}
                    className="inline-flex h-11 items-center gap-2 rounded-md bg-copper-deep px-3 text-sm font-medium text-copper-ink"
                  >
                    <Download className="size-4" aria-hidden="true" />
                    Download
                  </button>
                  {entry.books ? (
                    <button type="button" onClick={() => onOpen(entry)} className="h-11 rounded-md border border-line px-3 text-sm">
                      Open
                    </button>
                  ) : null}
                  <button type="button" onClick={() => onRemove(entry.id)} className="h-11 rounded-md px-3 text-sm text-ink-soft">
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function LoadDialog({
  busy,
  error,
  onClose,
  onFiles,
  onSample,
}: {
  busy: boolean;
  error: string;
  onClose: () => void;
  onFiles: (files: File[]) => void;
  onSample: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="load-title">
      <div className="w-full max-w-lg rounded-md border border-line bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id="load-title" className="text-lg font-semibold">
            Load the two sheets
          </h2>
          <button type="button" onClick={onClose} className="inline-flex size-11 items-center justify-center rounded-md border border-line" aria-label="Close">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-2 text-sm text-ink-soft">
          vAuto becomes the REVO list. The report’s Emissions and Key Code columns are combined into one.
          A car is to be advertised only when it has photos, emissions is a date or XMPT, and the designation is 3 or 4.
          After the two sheets merge, the list is saved with the app so a later update does not erase it.
        </p>
        <label className="mt-4 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-line bg-paper px-4 py-6 text-center">
          <Upload className="size-5 text-copper" aria-hidden="true" />
          <span className="mt-2 text-sm font-medium">{busy ? "Reading…" : "Choose the vAuto master and the DMS report"}</span>
          <span className="mt-1 text-xs text-ink-soft">.xls or .xlsx, either order. An old xref workbook works too.</span>
          <input
            type="file"
            accept=".xls,.xlsx,.xlsm"
            multiple
            className="sr-only"
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              onFiles(files);
            }}
          />
        </label>
        {error ? <p className="mt-3 text-sm text-bad">{error}</p> : null}
        <button type="button" onClick={onSample} className="mt-4 h-11 text-sm font-medium text-copper-deep">
          Use the Oct 5 sample
        </button>
      </div>
    </div>
  );
}
