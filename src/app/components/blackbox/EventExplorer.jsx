"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

const PAGE_SIZE = 50;
const POLL_MS = 8000;

/**
 * Raw Event Explorer.
 *
 * Shows exactly what the WordPress collector is sending, before any grouping or
 * scoring. Filters live in local state so the page needs no Suspense boundary,
 * and the feed polls rather than holding a socket open.
 */
export default function EventExplorer({ siteId, siteName, host, health, stats }) {
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState({ categories: [], types: [], actors: [] });
  const [filters, setFilters] = useState({ category: "", type: "", actor: "", q: "", incident: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const offsetRef = useRef(0);

  const buildUrl = useCallback(
    (offset) => {
      const p = new URLSearchParams({ site: siteId, limit: String(PAGE_SIZE), offset: String(offset), correlation: "1" });
      for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
      return `/api/blackbox/events?${p}`;
    },
    [siteId, filters]
  );

  const load = useCallback(
    async ({ reset = false } = {}) => {
      const offset = reset ? 0 : offsetRef.current;
      try {
        const res = await fetch(buildUrl(offset), { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setTotal(data.total ?? 0);
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

  // Reload from the start whenever a filter changes.
  useEffect(() => {
    setLoading(true);
    load({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.category, filters.type, filters.actor, filters.q, filters.incident, siteId]);

  // Light polling so new collector events appear without a manual refresh.
  useEffect(() => {
    const t = setInterval(() => load({ reset: true }), POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, filters.category, filters.type, filters.actor, filters.q, filters.incident]);

  const hasMore = events.length < total;

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
          See exactly what the ScanSite Collector is receiving from this WordPress website.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Events matching" value={String(total)} />
        <Stat label="Collector status" value={health?.label ?? "Unknown"} tone={health?.tone} />
        <Stat
          label="Last refresh"
          value={lastUpdated ? lastUpdated.toLocaleTimeString() : "—"}
          hint={error ? error : undefined}
        />
      </div>

      <EventFilters filters={filters} setFilters={setFilters} facets={facets} />

      {loading && events.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">Loading events…</p>
      ) : events.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">
          No events match these filters yet. The collector sends events as WordPress activity happens.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {events.map((e) => (
            <EventRow
              key={e.eventId}
              event={e}
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

      {selectedEvent && <EventDetail event={selectedEvent} onClose={() => setSelected(null)} />}
    </div>
  );
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
      <p className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-rose-600">{hint}</p> : null}
    </div>
  );
}

function EventFilters({ filters, setFilters, facets }) {
  const set = (key) => (event) => setFilters((f) => ({ ...f, [key]: event.target.value }));
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">
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

function EventRow({ event, open, onToggle }) {
  const time = new Date(event.timestamp);
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-slate-50"
      >
        <span className="w-20 shrink-0 font-mono text-xs text-slate-500">
          {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            {event.type.replace(/_/g, " ")}
          </span>
          <span className="mt-0.5 block truncate text-sm text-slate-900">{describe(event)}</span>
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

function EventDetail({ event, onClose }) {
  const c = event.correlation ?? {};
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {event.type.replace(/_/g, " ")}
          </h2>
          <p className="mt-0.5 font-mono text-xs text-slate-500">{event.eventId}</p>
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
      </dl>

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-slate-900">Correlation</h3>
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
      <dd className="truncate text-sm text-slate-900">{String(value)}</dd>
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

/** One-line human description of an event. */
function describe(e) {
  const name = e.target?.name ?? e.target?.username ?? e.target?.plugin ?? e.target?.theme ?? e.target?.hook ?? "";
  const change =
    e.changes?.from || e.changes?.to ? `${e.changes?.from ?? "?"} → ${e.changes?.to ?? "?"}` : "";
  if (name && change) return `${name} ${change}`;
  if (name) return name;
  if (e.path) return e.path;
  if (change) return change;
  if (e.metadata?.message) return String(e.metadata.message);
  return e.category || "—";
}
