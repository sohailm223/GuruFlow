"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export default function ProjectTable({ projects = [] }) {
  if (!projects.length) return null;

  const columns = [
    { key: "name", label: "Project", icon: "project", sortable: true },
    { key: "client", label: "Client", icon: "client", sortable: true },
    { key: "developer", label: "Developer", icon: "dev", sortable: true },
    { key: "pm", label: "PM", icon: "pm", sortable: true },
    { key: "startDate", label: "Start", icon: "calendar", sortable: true },
    { key: "endDate", label: "Delivered", icon: "calendar", sortable: true },
    { key: "status", label: "Status", icon: "status", sortable: true },
    { key: "view", label: "View", icon: "view", sortable: false },
  ];

  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [logoErrors, setLogoErrors] = useState({});

  const sortedProjects = useMemo(() => {
    const copy = [...projects];
    const dir = sortDir === "asc" ? 1 : -1;

    const getValue = (p, key) => {
      if (key === "pm") return p.pm?.name || "";
      if (key === "developer") return p.developer?.name || "";
      if (key === "client") return p.client?.name || p.clientName || "";
      if (key === "startDate") return p.startDate || "";
      if (key === "endDate") return p.endDate || "";
      return p[key] ?? "";
    };

    copy.sort((a, b) => {
      const aVal = getValue(a, sortKey);
      const bVal = getValue(b, sortKey);

      if (typeof aVal === "number" && typeof bVal === "number") {
        return (aVal - bVal) * dir;
      }
      return String(aVal).localeCompare(String(bVal)) * dir;
    });

    return copy;
  }, [projects, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const formatDate = (value) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "2-digit",
    });
  };

  const initials = (name) =>
    String(name || "")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");

  const logoColors = [
    "bg-emerald-100 text-emerald-700",
    "bg-sky-100 text-sky-700",
    "bg-indigo-100 text-indigo-700",
    "bg-amber-100 text-amber-700",
    "bg-rose-100 text-rose-700",
    "bg-teal-100 text-teal-700",
    "bg-violet-100 text-violet-700",
  ];

  const pickLogoColor = (name) => {
    const str = String(name || "");
    let hash = 0;
    for (let i = 0; i < str.length; i += 1) {
      hash = (hash + str.charCodeAt(i) * (i + 1)) % logoColors.length;
    }
    return logoColors[hash] || logoColors[0];
  };

  const statusStyles = (status) => {
    const value = String(status || "").toLowerCase().trim();
    if (value === "inprogress" || value === "in progress" || value === "active") {
      return "bg-blue-100 text-blue-800 ring-1 ring-blue-200";
    }
    if (value === "done" || value === "completed" || value === "complete") {
      return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200";
    }
    if (value === "unknown" || value === "pending") {
      return "bg-amber-100 text-amber-800 ring-1 ring-amber-200";
    }
    if (value.includes("overdue") || value.includes("blocked")) {
      return "bg-rose-100 text-rose-800 ring-1 ring-rose-200";
    }
    if (value.includes("on hold") || value.includes("paused")) {
      return "bg-orange-100 text-orange-800 ring-1 ring-orange-200";
    }
    return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500">
            Portfolio
          </p>
          <h2 className="text-xl font-semibold text-slate-900">
            Projects
          </h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          Sorted by {columns.find((c) => c.key === sortKey)?.label} ({sortDir})
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-[0.2em] text-slate-500">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className="flex w-full items-center justify-between gap-2 text-left font-semibold hover:text-slate-700"
                      >
                        <span className="inline-flex items-center gap-2">
                          {col.icon === "project" && (
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                              <path d="M4 7h16M4 12h10M4 17h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          )}
                          {col.icon === "client" && (
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
                              <path d="M5 19c1.5-3 5-4 7-4s5.5 1 7 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          )}
                          {col.icon === "dev" && (
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                              <path d="M8 8l-3 4 3 4M16 8l3 4-3 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                          {col.icon === "pm" && (
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                              <path d="M7 12h10M7 16h6M7 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          )}
                          {col.icon === "calendar" && (
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                              <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
                              <path d="M16 3v4M8 3v4M3 10h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          )}
                          {col.icon === "status" && (
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                              <path d="M7 12l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                          <span>{col.label}</span>
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {sortKey === col.key
                            ? sortDir === "asc"
                              ? "▲"
                              : "▼"
                            : "↕"}
                        </span>
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-2 text-left font-semibold text-slate-400">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                          <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6Z" stroke="currentColor" strokeWidth="1.5" />
                          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
                        </svg>
                        <span>{col.label}</span>
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {sortedProjects.map((p) => {
              return (
              <tr
                key={p.id}
                className="bg-white transition hover:bg-slate-50"
              >
                <td className="px-4 py-3 font-medium text-slate-900">
                  <div className="flex items-center gap-3">
                    {p.logoUrl || p.logo || p.image ? (
                      logoErrors[p.id] ? (
                        <Link
                          href={`/projects/${p.slug}`}
                          className={`grid h-8 w-8 place-items-center rounded-lg text-xs font-semibold ${pickLogoColor(
                            p.name
                          )}`}
                        >
                          {initials(p.name) || "PR"}
                        </Link>
                      ) : (
                        <Link href={`/projects/${p.slug}`} className="block">
                          <img
                            src={p.logoUrl || p.logo || p.image}
                            alt={p.name ? `${p.name} logo` : "Project logo"}
                            className="h-8 w-8 rounded-lg border border-slate-200 object-cover"
                            loading="lazy"
                            onError={() =>
                              setLogoErrors((prev) => ({
                                ...prev,
                                [p.id]: true,
                              }))
                            }
                          />
                        </Link>
                      )
                    ) : (
                      <Link
                        href={`/projects/${p.slug}`}
                        className={`grid h-8 w-8 place-items-center rounded-lg text-xs font-semibold ${pickLogoColor(
                          p.name
                        )}`}
                      >
                        {initials(p.name) || "PR"}
                      </Link>
                    )}
                    <Link
                      href={`/projects/${p.slug}`}
                      className="truncate hover:text-slate-700"
                    >
                      {p.name}
                    </Link>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {p.client?.name || p.clientName || "-"}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {p.developer?.name || "-"}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {p.pm?.name ? (
                    p.pm.name
                  ) : (
                    <a
                      href="/users"
                      className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
                    >
                      Add PM
                    </a>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {formatDate(p.startDate)}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {formatDate(p.endDate)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles(
                      p.status
                    )}`}
                  >
                    {p.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/projects/${p.slug}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
                    aria-label={`Quick view ${p.name}`}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6Z" stroke="currentColor" strokeWidth="1.5" />
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                  </Link>
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
    </div>
  );
}
