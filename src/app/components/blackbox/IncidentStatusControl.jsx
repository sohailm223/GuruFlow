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

const FP_REASONS = [
  "Known plugin/theme behaviour",
  "Expected scheduled task (cron)",
  "Legitimate administrator action",
  "Our own deployment or tooling",
  "Duplicate of another incident",
  "Other — explained in note",
];

/**
 * Incident lifecycle: status transitions, false-positive reasoning and notes.
 *
 * Marking an incident as a false positive requires a reason — a verdict without
 * a reason is worthless later, and the reason is what makes the next identical
 * alert fast to dismiss. Notes are append-only so the investigation history
 * survives status changes.
 */
export default function IncidentStatusControl({
  incidentId,
  status,
  falsePositiveReason,
  notes = [],
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingFp, setPendingFp] = useState(false);
  const [fpReason, setFpReason] = useState(falsePositiveReason ?? "");
  const [note, setNote] = useState("");

  const send = async (body) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/blackbox/incidents/${incidentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Could not update incident");
      }
      router.refresh();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const pick = async (next) => {
    if (next === status) return;
    if (next === "false_positive") {
      setPendingFp(true);
      return;
    }
    setPendingFp(false);
    await send({ status: next });
  };

  const confirmFp = async () => {
    const ok = await send({ status: "false_positive", falsePositiveReason: fpReason });
    if (ok) setPendingFp(false);
  };

  const addNote = async () => {
    if (!note.trim()) return;
    const ok = await send({ note: note.trim() });
    if (ok) setNote("");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {STATUSES.map(([value, label]) => (
          <button
            key={value}
            onClick={() => pick(value)}
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
      </div>

      {pendingFp && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-700">Why is this a false positive?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {FP_REASONS.map((reason) => (
              <button
                key={reason}
                onClick={() => setFpReason(reason)}
                className={`rounded-lg px-2.5 py-1 text-xs transition ${
                  fpReason === reason
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-100"
                }`}
              >
                {reason}
              </button>
            ))}
          </div>
          <input
            value={fpReason}
            onChange={(e) => setFpReason(e.target.value)}
            placeholder="Or type the reason…"
            maxLength={300}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none"
          />
          <div className="mt-3 flex gap-2">
            <button
              onClick={confirmFp}
              disabled={busy || !fpReason.trim()}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Mark false positive
            </button>
            <button
              onClick={() => setPendingFp(false)}
              disabled={busy}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {status === "false_positive" && falsePositiveReason && !pendingFp && (
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-700">False positive reason:</span> {falsePositiveReason}
        </p>
      )}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</p>
        {notes.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No notes yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {notes.map((entry) => (
              <li key={entry.id ?? entry.at} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <p className="whitespace-pre-wrap text-sm text-slate-700">{entry.text}</p>
                <p className="mt-1 text-xs text-slate-400">{new Date(entry.at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex gap-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Record what you checked, what you ruled out, what you changed…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            onClick={addNote}
            disabled={busy || !note.trim()}
            className="shrink-0 self-start rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Add note
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
