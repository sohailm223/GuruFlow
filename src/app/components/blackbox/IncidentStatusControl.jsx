"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUSES = [
  ["new", "New"],
  ["investigating", "Investigating"],
  ["confirmed", "Confirmed"],
  ["false_positive", "False positive"],
  ["remediated", "Remediated"],
  ["monitoring", "Monitoring"],
  ["resolved", "Resolved"],
];

/**
 * Drives the incident status, including the false-positive flow.
 */
export default function IncidentStatusControl({ incidentId, status }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const setStatus = async (next) => {
    if (next === status) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/blackbox/incidents/${incidentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Could not update status");
      }
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {STATUSES.map(([value, label]) => (
        <button
          key={value}
          onClick={() => setStatus(value)}
          disabled={busy || value === status}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-default ${
            value === status
              ? "bg-slate-900 text-white"
              : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
          }`}
        >
          {label}
        </button>
      ))}
      {error && <p className="w-full text-xs text-rose-600">{error}</p>}
    </div>
  );
}
