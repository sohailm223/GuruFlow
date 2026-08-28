"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { describeEvent } from "@/lib/blackbox/schemas";

const PAGE_SIZE = 50;
const POLL_MS = 8000;

const DATE_PRESETS = [
  { id: "all", label: "All time", ms: 0 },
  { id: "today", label: "Today", ms: -1 },
  { id: "24h", label: "Last 24 hours", ms: 24 * 3_600_000 },
  { id: "7d", label: "Last 7 days", ms: 7 * 24 * 3_600_000 },
  { id: "30d", label: "Last 30 days", ms: 30 * 24 * 3_600_000 },
];

const EMPTY_FILTERS = { category: "", type: "", actor: "", q: "", incident: "", date: "all" };

/**
 * Raw Event Explorer.
 *
 * Shows exactly what the WordPress collector is sending, before any grouping or
 * scoring. Filters live in local state so the page needs no Suspense boundary,
 * and the feed polls rather than holding a socket open.
 */
export default function EventExplorer({ siteId, siteName, host, health, initialFilters = {}, initialIncidents = [] }) {
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ eventsToday: 0, lastEventAt: null, totalAllTime: 0 });
  const [facets, setFacets] = useState({ categories: [], types: [], actors: [] });
  const [incidents, setIncidents] = useState(initialIncidents);
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, ...initialFilters });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const offsetRef = useRef(0);

  // "Today" is resolved once per load, not during render.
  const todayStart = useRef(startOfToday());

  const dateFrom = useMemo(() => {
    const preset = DATE_PRESETS.find((p) => p.id === filters.date);
    if (!preset || preset.ms === 0) return 0;
    if (preset.ms === -1) return todayStart.current;
    return Date.now() - preset.ms;
  }, [filters.date]);

  const buildUrl = useCallback(
    (offset) => {
      const p = new URLSearchParams({
        site: siteId,
        limit: String(PAGE_SIZE),
        offset: String(offset),
        correlation: "1",
      });
      for (const key of ["category", "type", "actor", "q", "incident"]) {
        if (filters[key]) p.set(key, filters[key]);
      }
      if (dateFrom) p.set("from", String(dateFrom));
      return `/api/blackbox/events?${p}`;
    },
    [siteId, filters, dateFrom]
  );

  const load = useCallback(
    async ({ reset = false } = {}) => {
      const offset = reset ? 0 : offsetRef.current;
      try {
        const res = await fetch(buildUrl(offset), { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setTotal(data.total ?? 0);
        setStats(data.stats ?? { eventsToday: 0, lastEventAt: null, totalAllTime: 0 });
        setFacets(data.facets ?? { categories: [], types: [], actors: [] });
        setEvents((prev) => (reset ? data.events : [...prev, ...data.events]));
        offsetRef.current = offset + (data.events?.length ?? 0);
        setLastUpdated(new Date());
        setError(null);
      } catch (e) {
        setError(e.message || "Could not load events");
      } finally {
        setLoading(false);
      }
    },
    [buildUrl]
  );

  // The incident dropdown is seeded from the server so it is not empty on
  // first paint; this refresh keeps it current as new incidents are grouped.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/blackbox/incidents?site=${siteId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { incidents: [] }))
      .then((d) => {
        if (!cancelled) setIncidents(d.incidents ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  // Reload from the start whenever a filter changes.
  useEffect(() => {
    setLoading(true);
    load({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.category, filters.type, filters.actor, filters.q, filters.incident, filters.date, siteId]);

  // Light polling so new collector events appear without a manual refresh.
  useEffect(() => {
    const t = setInterval(() => load({ reset: true }), POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.category, filters.type, filters.actor, filters.q, filters.incident, filters.date, siteId]);

  // Escape closes the open detail panel.
  useEffect(() => {
    if (!selected) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const hasMore = events.length < total;
  const filtersActive = Object.entries(filters).some(
    ([k, v]) => v && !(k === "date" && v === "all")
  );

  const selectedEvent = useMemo(
    () => (selected ? events.find((e) => e.eventId === selected) ?? null : null),
    [selected, events]
  );

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href={`/websites/${siteId}`} className="text-sm text-slate-500 hover:text-slate-800">
          ← {siteName}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Raw Events</h1>
        <p className="max-w-2xl text-sm text-slate-500">
          See exactly what the ScanSite Collector is receiving from {host}.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Events today" value={String(stats.eventsToday)} hint={`${stats.totalAllTime} all time`} />
        <Stat label="Last event" value={stats.lastEventAt ? relTime(stats.lastEventAt, lastUpdated) : "None yet"} hint={stats.lastEventAt ? new Date(stats.lastEventAt).toLocaleString() : undefined} />
        <Stat label="Collector status" value={health?.label ?? "Unknown"} tone={health?.tone} />
        <Stat label="Matching filters" value={String(total)} hint={error ? error : lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : undefined} tone={error ? "bad" : undefined} />
      </div>

      <EventFilters filters={filters} setFilters={setFilters} facets={facets} incidents={incidents} />

      {filtersActive && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-slate-500">
            Showing {events.length} of {total} matching event{total === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Clear all filters
          </button>
        </div>
      )}

      {loading && events.length === 0 ? (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="px-4 py-4">
              <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
              <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-slate-100" />
            </li>
          ))}
        </ul>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm font-medium text-slate-700">No events match these filters</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            {filtersActive
              ? "Try widening the date range or clearing a filter. The collector sends events as WordPress activity happens."
              : "Nothing has been received from this website yet. Install the collector and perform an action in WordPress."}
          </p>
          {filtersActive && (
            <button
              type="button"
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="mt-4 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {events.map((e) => (
            <EventRow
              key={e.eventId}
              event={e}
              todayStart={todayStart.current}
              open={selected === e.eventId}
              onToggle={() => setSelected(selected === e.eventId ? null : e.eventId)}
            />
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "Loading…" : `Load ${Math.min(PAGE_SIZE, total - events.length)} more`}
          </button>
        </div>
      )}

      {selectedEvent && <EventDetail event={selectedEvent} siteId={siteId} onClose={() => setSelected(null)} />}
    </div>
  );
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** Relative time, derived from the last successful fetch rather than render time. */
function relTime(ts, now) {
  if (!now) return new Date(ts).toLocaleTimeString();
  const mins = Math.round((now.getTime() - ts) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function Stat({ label, value, tone, hint }) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "bad"
          ? "text-rose-700"
          : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-lg font-semibold ${toneClass}`}>{value}</p>
      {hint ? (
        <p className={`mt-1 truncate text-xs ${tone === "bad" ? "text-rose-600" : "text-slate-400"}`}>{hint}</p>
      ) : null}
    </div>
  );
}

function EventFilters({ filters, setFilters, facets, incidents }) {
  const set = (key) => (event) => setFilters((f) => ({ ...f, [key]: event.target.value }));
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-sm sm:col-span-2 lg:col-span-1">
        <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Search</span>
        <input
          value={filters.q}
          onChange={set("q")}
          placeholder="plugin, username, path, IP, event ID"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-600"
        />
      </label>
      <FilterSelect label="Category" value={filters.category} onChange={set("category")} options={facets.categories} />
      <FilterSelect label="Event type" value={filters.type} onChange={set("type")} options={facets.types} />
      <FilterSelect label="Actor" value={filters.actor} onChange={set("actor")} options={facets.actors} />
      <label className="text-sm">
        <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Date</span>
        <select
          value={filters.date}
          onChange={set("date")}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
        >
          {DATE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Incident</span>
        <select
          value={filters.incident}
          onChange={set("incident")}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
        >
          <option value="">All</option>
          {incidents.map((i) => (
            <option key={i.id} value={i.id}>
              {i.severity?.toUpperCase()} — {i.title}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options = [] }) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={onChange}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value} ({o.count})
          </option>
        ))}
      </select>
    </label>
  );
}

function EventRow({ event, open, onToggle, todayStart }) {
  const time = new Date(event.timestamp);
  // Rows only showed a clock time, so with a multi-day filter there was no way
  // to tell which day an event belonged to.
  const isToday = event.timestamp >= todayStart;
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex w-full flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-slate-50 ${
          open ? "bg-slate-50" : ""
        }`}
      >
        <span className="w-24 shrink-0 font-mono text-xs text-slate-500">
          <span className="block">
            {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          {!isToday && (
            <span className="block text-[11px] text-slate-400">
              {time.toLocaleDateString([], { month: "short", day: "numeric" })}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            {event.type.replace(/_/g, " ")}
          </span>
          <span className="mt-0.5 block truncate text-sm text-slate-900">{describeEvent(event)}</span>
          <span className="mt-0.5 block truncate text-xs text-slate-500">
            {event.actor?.username ? `Actor ${event.actor.username}` : "No actor"}
            {event.actor?.ip ? ` · IP ${event.actor.ip}` : ""}
            {` · ${event.eventId}`}
          </span>
        </span>
        {event.incident ? (
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {event.incident.severity?.toUpperCase()} incident
          </span>
        ) : null}
      </button>
    </li>
  );
}

function EventDetail({ event, siteId, onClose }) {
  const c = event.correlation ?? {};
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">{event.type.replace(/_/g, " ")}</h2>
          <p className="mt-0.5 truncate font-mono text-xs text-slate-500">{event.eventId}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
        >
          Close
        </button>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Field label="Summary" value={describeEvent(event)} />
        <Field label="Category" value={event.category} />
        <Field label="Timestamp" value={`${new Date(event.timestamp).toISOString()} (UTC)`} />
        <Field label="Actor" value={event.actor?.username ?? "—"} />
        <Field label="Actor role" value={event.actor?.role ?? "—"} />
        <Field label="IP" value={event.actor?.ip ?? "—"} />
        <Field label="Target" value={event.target?.name ?? event.target?.plugin ?? event.target?.hook ?? "—"} />
        <Field
          label="Change"
          value={
            event.changes?.from || event.changes?.to
              ? `${event.changes?.from ?? "?"} → ${event.changes?.to ?? "?"}`
              : "—"
          }
        />
        <Field label="Path" value={event.path ?? "—"} />
        <Field label="Severity hint" value={event.severityHint ?? "none"} />
      </dl>

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-slate-900">Correlation</h3>
        <p className="mt-1 text-xs text-slate-500">
          How many other events from this website share each signal with this one.
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <Chip label="Same actor" value={c.sameActor} />
          <Chip label="Same IP" value={c.sameIp} />
          <Chip label="Same plugin" value={c.samePlugin} />
          <Chip label="Same incident" value={c.sameIncident} />
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-slate-900">Incident</h3>
        {event.incident ? (
          <p className="mt-1 text-sm text-slate-700">
            Part of{" "}
            <Link href={`/incidents/${event.incident.id}`} className="font-medium text-teal-700 hover:underline">
              {event.incident.title} →
            </Link>
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">
            No incident — this event has not been grouped into a significant incident.
          </p>
        )}
      </div>

      <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-700">View raw payload</summary>
        <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-700">
          {JSON.stringify(event, null, 2)}
        </pre>
      </details>
    </section>
  );
}

function Field({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="truncate text-sm text-slate-900" title={String(value)}>
        {String(value)}
      </dd>
    </div>
  );
}

function Chip({ label, value }) {
  return (
    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600">
      {label}: <strong className="text-slate-900">{value ?? 0}</strong>
    </span>
  );
}
