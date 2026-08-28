"use client";

import { useState } from "react";
import { timeAgo } from "@/lib/blackbox/sites";

export default function ScanControls({ siteId, lastScan, now }) {
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(null);

  const request = async (mode) => {
    setBusy(mode);
    setNote(null);
    try {
      const res = await fetch(`/api/blackbox/sites/${siteId}/files/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      setNote(
        res.ok
          ? `${mode === "deep" ? "Deep" : "Quick"} scan requested — the collector starts it on its next heartbeat and reports progress as events.`
          : data.error ?? "Could not request scan.",
      );
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => request("quick")}
        disabled={busy !== null}
        className="rounded-lg bg-teal-700 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-60"
      >
        {busy === "quick" ? "Requesting…" : "Run Quick Scan"}
      </button>
      <button
        onClick={() => request("deep")}
        disabled={busy !== null}
        className="rounded-lg bg-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-300 disabled:opacity-60"
      >
        {busy === "deep" ? "Requesting…" : "Run Deep Scan"}
      </button>
      {lastScan && (
        <span className="text-xs text-slate-400">
          Last scan {timeAgo(lastScan.requestedAt ?? lastScan.at, now)}
        </span>
      )}
      {note && <p className="w-full text-xs text-slate-500">{note}</p>}
    </div>
  );
}
