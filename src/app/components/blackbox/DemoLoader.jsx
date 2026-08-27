"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Seeds the reference compromise scenario via POST /api/blackbox/demo.
 */
export default function DemoLoader() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/blackbox/demo", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load demo incident");
      const id = data.incidents?.[0]?.id;
      router.push(id ? `/incidents/${id}` : "/incidents");
      router.refresh();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={load}
        disabled={loading}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {loading ? "Replaying tape…" : "Load demo incident"}
      </button>
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
