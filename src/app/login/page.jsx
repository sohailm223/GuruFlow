"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";

// useSearchParams() requires a Suspense boundary so the page can pre-render
// during `next build`.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const setup = params.get("setup") === "1";
  const [username, setUsername] = useState("");
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
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        window.location.href = next;
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Incorrect username or password.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-8"
      >
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-teal-600 text-white">
          <ShieldCheck size={22} />
        </div>
        <h1 className="mt-4 text-center text-lg font-semibold text-slate-100">
          ScanSite Black Box
        </h1>
        <p className="mt-1 text-center text-sm text-slate-500">
          This dashboard is private. Sign in with the local administrator account.
        </p>

        {setup && (
          <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">
            Authentication is mandatory but not configured yet. Set{" "}
            <code className="font-mono">SCANSITE_ADMIN_PASSWORD</code> (and optionally{" "}
            <code className="font-mono">SCANSITE_ADMIN_USER</code>) on the server, then reload.
          </p>
        )}

        <label className="mt-6 block text-sm font-medium text-slate-300">
          Username
          <input
            type="text"
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 focus:outline-none"
            required
          />
        </label>

        <label className="mt-4 block text-sm font-medium text-slate-300">
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 focus:outline-none"
            required
          />
        </label>

        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-500 disabled:opacity-60"
        >
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
