"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/blackbox/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = next;
      } else {
        setError("Incorrect password.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-teal-700 text-white">
          <ShieldCheck size={22} />
        </div>
        <h1 className="mt-4 text-center text-lg font-semibold text-slate-900">
          ScanSite Black Box
        </h1>
        <p className="mt-1 text-center text-sm text-slate-500">
          This dashboard is private. Enter the shared password to continue.
        </p>

        <label className="mt-6 block text-sm font-medium text-slate-700">
          Password
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
            required
          />
        </label>

        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:opacity-60"
        >
          {busy ? "Checking…" : "Unlock dashboard"}
        </button>
      </form>
    </main>
  );
}
