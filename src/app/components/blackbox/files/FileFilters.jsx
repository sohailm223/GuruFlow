"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

const STATUSES = [
  ["", "All"],
  ["critical", "Critical"],
  ["suspicious", "Suspicious"],
  ["modified", "Modified"],
  ["expected_change", "Expected"],
  ["verified", "Verified"],
];

const CATEGORIES = ["", "wordpress_core", "plugin", "theme", "uploads", "config", "unknown"];

export default function FileFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = params.get("status") ?? "";
  const category = params.get("category") ?? "";
  const search = params.get("search") ?? "";

  const go = (key, value) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {STATUSES.map(([value, label]) => (
        <button
          key={value || "all"}
          onClick={() => go("status", value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
            status === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          {label}
        </button>
      ))}

      <select
        value={category}
        onChange={(e) => go("category", e.target.value)}
        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
      >
        {CATEGORIES.map((c) => (
          <option key={c || "all"} value={c}>
            {c ? c.replace("wordpress_", "") : "All areas"}
          </option>
        ))}
      </select>

      <input
        value={search}
        onChange={(e) => go("search", e.target.value)}
        placeholder="Search filename, path, signal…"
        className="ml-auto w-56 rounded-md border border-slate-200 px-2.5 py-1 text-xs focus:border-teal-600 focus:outline-none"
      />
    </div>
  );
}
