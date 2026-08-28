"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { timeAgo } from "@/lib/blackbox/sites";
import ConnectionStatus from "./ConnectionStatus";
import ConfirmDialog from "./ConfirmDialog";

/**
 * Connection tab: status plus the actions that change it.
 *
 * Rotate Key returns a new secret that is shown exactly once — ScanSite never
 * displays a permanent key again after that.
 */
export default function ConnectionPanel({ site, health }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [newKey, setNewKey] = useState(null);
  const [confirm, setConfirm] = useState(null); // "disconnect" | "delete"

  const post = async (path) => {
    const res = await fetch(path, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? "Request failed");
    return data;
  };

  const act = async (name, fn) => {
    setBusy(name);
    setError("");
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const test = () =>
    act("test", async () => {
      const data = await post(`/api/blackbox/sites/${site.id}/verify`);
      setNewKey({ kind: "test", checks: data.checks });
    });

  const rotate = () =>
    act("rotate", async () => {
      const data = await post(`/api/blackbox/sites/${site.id}/rotate-key`);
      setNewKey({ kind: "rotate", key: data.collectorKey, warning: data.warning });
    });

  const reconnect = () =>
    act("reconnect", async () => {
      const data = await post(`/api/blackbox/sites/${site.id}/reconnect`);
      setNewKey({
        kind: "reconnect",
        code: data.connection.code,
        expiresAt: data.connection.expiresAt,
      });
    });

  const disconnect = () =>
    act("disconnect", async () => {
      await post(`/api/blackbox/sites/${site.id}/disconnect`);
      setConfirm(null);
    });

  const remove = () =>
    act("delete", async () => {
      const res = await fetch(`/api/blackbox/sites/${site.id}?purge=true`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Could not delete the website");
      }
      router.push("/websites");
      router.refresh();
    });

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Connection</h2>

      <div className="mt-4">
        <ConnectionStatus health={health} />
      </div>

      <dl className="mt-5 space-y-2.5 text-sm">
        <Row label="Last Seen" value={timeAgo(site.lastSeenAt)} />
        <Row
          label="Connected Since"
          value={site.connectedAt ? new Date(site.connectedAt).toLocaleDateString() : "—"}
        />
        <Row label="Collector" value={site.collectorVersion ?? "—"} />
        <Row label="WordPress" value={site.wordpress?.wordpressVersion ?? "—"} />
        <Row label="PHP" value={site.wordpress?.phpVersion ?? "—"} />
      </dl>

      <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-100 pt-5">
        <Action onClick={test} busy={busy === "test"}>
          Test Connection
        </Action>
        <Action onClick={rotate} busy={busy === "rotate"}>
          Rotate Key
        </Action>
        <Action onClick={reconnect} busy={busy === "reconnect"}>
          Reconnect
        </Action>
        <Action onClick={() => setConfirm("disconnect")} tone="danger">
          Disconnect
        </Action>
      </div>

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

      {newKey?.kind === "rotate" && (
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">New collector key</p>
          <p className="mt-1 break-all font-mono text-xs text-amber-900">{newKey.key}</p>
          <p className="mt-2 text-xs text-amber-800">{newKey.warning}</p>
          <p className="mt-1 text-xs text-amber-800">
            This key is shown once. Copy it now — it will not be displayed again.
          </p>
          <button
            onClick={() => setNewKey(null)}
            className="mt-3 text-xs font-medium text-amber-900 underline"
          >
            I&apos;ve saved it
          </button>
        </div>
      )}

      {newKey?.kind === "reconnect" && (
        <div className="mt-5 rounded-lg border border-teal-200 bg-teal-50 p-4">
          <p className="text-sm font-medium text-teal-900">New connection code</p>
          <p className="mt-1 font-mono text-lg font-semibold tracking-[0.2em] text-teal-900">
            {newKey.code}
          </p>
          <p className="mt-2 text-xs text-teal-800">
            Enter this in WordPress → ScanSite Black Box. The previous key no longer works.
          </p>
          <button
            onClick={() => setNewKey(null)}
            className="mt-3 text-xs font-medium text-teal-900 underline"
          >
            Done
          </button>
        </div>
      )}

      {newKey?.kind === "test" && (
        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-900">Connection test</p>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            {Object.entries(newKey.checks).map(([name, value]) => (
              <li key={name} className="flex justify-between gap-4">
                <span className="capitalize">{name.replace(/([A-Z])/g, " $1")}</span>
                <span className="font-medium">{value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 border-t border-slate-100 pt-5">
        <button
          onClick={() => setConfirm("delete")}
          className="text-sm font-medium text-rose-600 hover:underline"
        >
          Delete Website
        </button>
        <p className="mt-1 text-xs text-slate-400">
          Deleting removes the website and its locally stored events and incidents.
        </p>
      </div>

      <ConfirmDialog
        open={confirm === "disconnect"}
        title={`Disconnect ${site.name}?`}
        body="ScanSite will stop accepting new events from this WordPress website. Existing incidents will remain available locally."
        confirmLabel="Disconnect"
        onCancel={() => setConfirm(null)}
        onConfirm={disconnect}
        busy={busy === "disconnect"}
      />

      <ConfirmDialog
        open={confirm === "delete"}
        title={`Delete ${site.name}?`}
        body="This permanently removes the website along with its locally stored events and incidents. Disconnect instead if you only want to stop collecting."
        confirmLabel="Delete Website"
        onCancel={() => setConfirm(null)}
        onConfirm={remove}
        busy={busy === "delete"}
      />
    </section>
  );
}

function Action({ children, onClick, busy, tone }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition disabled:opacity-60 ${
        tone === "danger"
          ? "text-rose-600 ring-rose-200 hover:bg-rose-50"
          : "text-slate-700 ring-slate-200 hover:bg-slate-50"
      }`}
    >
      {busy ? "Working…" : children}
    </button>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate font-medium text-slate-800">{value}</dd>
    </div>
  );
}
