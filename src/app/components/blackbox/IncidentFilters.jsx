"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/blackbox/schemas";

const SEVERITIES = [
  ["", "All severities"],
  ["critical", "Critical"],
  ["high", "High"],
  ["medium", "Medium"],
  ["low", "Low"],
  ["info", "Info"],
];

const STATUSES = [
  ["", "All statuses"],
  ["new", "New"],
  ["investigating", "Investigating"],
  ["confirmed", "Confirmed"],
  ["false_positive", "False positive"],
  ["remediated", "Remediated"],
  ["monitoring", "Monitoring"],
  ["resolved", "Resolved"],
];

/**
 * Website / severity / status / date / category filters plus free-text search.
 * Kept in the query string so a filtered view can be shared.
 */
export default function IncidentFilters({ sites }) {
  const router = useRouter();
  const params = useSearchParams();

  const set = useCallback(
    (key, value) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(`/incidents${next.size ? `?${next}` : ""}`);
    },
    [params, router]
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <Input
        label="Search"
        value={params.get("q") ?? ""}
        placeholder="plugin, file, user, IP…"
        onChange={(v) => set("q", v)}
        span
      />

      <Select label="Website" value={params.get("site") ?? ""} onChange={(v) => set("site", v)}>
        <option value="">All websites</option>
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </Select>

      <Select
        label="Severity"
        value={params.get("severity") ?? ""}
        onChange={(v) => set("severity", v)}
        options={SEVERITIES}
      />

      <Select
        label="Status"
        value={params.get("status") ?? ""}
        onChange={(v) => set("status", v)}
        options={STATUSES}
      />

      <Select
        label="Category"
        value={params.get("category") ?? ""}
        onChange={(v) => set("category", v)}
      >
        <option value="">All categories</option>
        {CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {CATEGORY_LABELS[category]}
          </option>
        ))}
      </Select>

      <Input
        label="From"
        type="date"
        value={params.get("from") ?? ""}
        onChange={(v) => set("from", v ? String(new Date(v).getTime()) : "")}
      />
    </div>
  );
}

function Select({ label, value, onChange, options, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
      >
        {options
          ? options.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))
          : children}
      </select>
    </label>
  );
}

function Input({ label, value, onChange, placeholder, type = "text", span }) {
  return (
    <label className={`block ${span ? "sm:col-span-2 lg:col-span-1" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
      />
    </label>
  );
}
