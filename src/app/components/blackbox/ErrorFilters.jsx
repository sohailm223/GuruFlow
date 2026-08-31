"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { ERROR_KINDS } from "@/lib/blackbox/errors";

/**
 * Family filter tabs for the /errors page.
 *
 * The filter lives in the query string so a filtered view can be shared, and
 * the server component does the filtering — these buttons only rewrite the URL.
 * That keeps the list a server component, so it is rendered once and needs no
 * client-side copy of the error data.
 */
export default function ErrorFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const active = params.get("kind") ?? "";

  const set = useCallback(
    (value) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set("kind", value);
      else next.delete("kind");
      router.replace(`/errors${next.size ? `?${next}` : ""}`);
    },
    [params, router]
  );

  const tabs = [["", "All"], ...ERROR_KINDS.map((k) => [k.id, k.label])];

  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Error type">
      {tabs.map(([id, label]) => {
        const on = active === id;
        return (
          <button
            key={id || "all"}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => set(id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              on
                ? "border-teal-500 bg-teal-500/15 text-teal-300"
                : "border-slate-700 bg-slate-900/40 text-slate-400 hover:border-slate-600 hover:text-slate-300"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
