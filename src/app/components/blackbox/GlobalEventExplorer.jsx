"use client";

import { useState } from "react";
import EventExplorer from "./EventExplorer";

/**
 * Global Raw Event Explorer.
 *
 * The per-website explorer is scoped by route; this one adds a Website filter so
 * every collector's stream can be inspected from a single place. Site selection
 * lives in client state because the explorer filters without a page navigation.
 */
export default function GlobalEventExplorer({ sites }) {
  const [siteId, setSiteId] = useState("");
  const site = sites.find((s) => s.id === siteId);

  return (
    <EventExplorer
      siteId={siteId}
      siteName={site?.name ?? "All websites"}
      host={site?.url ?? "every connected website"}
      health={site?.collector ?? null}
      sites={sites}
      onSiteChange={setSiteId}
      initialIncidents={[]}
    />
  );
}
