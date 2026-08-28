/**
 * Demo data — the reference compromise from the product brief, plus a
 * contrasting routine-maintenance case so severity levels can be compared.
 *
 * Demo sites use fixed ids (`site_demo_…`) and carry `demo: true`, so demo
 * data never mixes with a real connected website.
 */

import { createSiteRecord } from "./sites";
import { issueConnectionCode, redeemConnectionCode } from "./connection";
import { getConnection, createSite, updateSite } from "./storage";
import { ingestEvents } from "./ingest";

const MIN = 60_000;

export const DEMO_SITE_SPECS = [
  {
    id: "site_demo_copper",
    name: "Copper Sky Hearing",
    url: "https://copperskyhearing.com",
    environment: "production",
  },
  {
    id: "site_demo_cenexel",
    name: "CenExel",
    url: "https://cenexel.com",
    environment: "production",
  },
];

/** The compromise timeline from the brief, relative to `now`. */
export function compromiseEvents(now = Date.now()) {
  const t = now - 14 * MIN;
  return [
    {
      eventId: "evt_demo_plugin_update",
      type: "plugin_updated",
      category: "plugin",
      timestamp: new Date(t).toISOString(),
      severityHint: "info",
      actor: { username: "auto-updater", role: "system" },
      target: { plugin: "elementor-pro", name: "Elementor Pro" },
      changes: { from: "3.28.1", to: "3.29.0" },
    },
    {
      eventId: "evt_demo_files_changed",
      type: "files_changed",
      category: "file",
      timestamp: new Date(t + 2 * MIN).toISOString(),
      count: 47,
      path: "/wp-content/plugins/elementor-pro",
    },
    {
      eventId: "evt_demo_admin_created",
      type: "administrator_created",
      category: "user",
      timestamp: new Date(t + 3 * MIN).toISOString(),
      severityHint: "high",
      actor: { userId: 42, username: "support_wp", role: "administrator", ip: "185.220.101.44" },
      target: { username: "support_wp" },
      changes: { to: "administrator" },
    },
    {
      eventId: "evt_demo_option",
      type: "active_plugins_changed",
      category: "db",
      timestamp: new Date(t + 5 * MIN).toISOString(),
      actor: { userId: 42, username: "support_wp", role: "administrator", ip: "185.220.101.44" },
      target: { name: "active_plugins" },
    },
    {
      eventId: "evt_demo_webshell",
      type: "executable_created",
      category: "file",
      timestamp: new Date(t + 9 * MIN).toISOString(),
      severityHint: "critical",
      actor: { userId: 42, username: "support_wp", role: "administrator", ip: "185.220.101.44" },
      path: "/wp-content/uploads/cache/x1.php",
      target: { path: "/wp-content/uploads/cache/x1.php", name: "x1.php" },
      metadata: {
        extension: ".php",
        executable: true,
        bytes: 4311,
        permissions: "0644",
        sha256: null,
      },
    },
    {
      eventId: "evt_demo_cron",
      type: "cron_added",
      category: "cron",
      timestamp: new Date(t + 10 * MIN).toISOString(),
      actor: { userId: 42, username: "support_wp", role: "administrator", ip: "185.220.101.44" },
      target: { hook: "wp_health_check_hourly", name: "wp_health_check_hourly" },
      metadata: { schedule: "hourly", nextRun: new Date(t + 70 * MIN).toISOString() },
    },
    {
      eventId: "evt_demo_errors",
      type: "site_error_burst",
      category: "core",
      timestamp: new Date(t + 11 * MIN).toISOString(),
      severityHint: "high",
      metadata: { httpStatus: 500, requests: 312 },
    },
  ];
}

/** Contrast case: plain maintenance, should land on INFO. */
export function routineEvents(now = Date.now()) {
  return [
    {
      eventId: "evt_demo_yoast",
      type: "plugin_updated",
      category: "plugin",
      timestamp: new Date(now - 6 * MIN).toISOString(),
      actor: { username: "j.rivera", role: "administrator", ip: "203.0.113.9" },
      target: { plugin: "wordpress-seo", name: "Yoast SEO" },
      changes: { from: "23.1", to: "23.2" },
    },
    {
      eventId: "evt_demo_astra",
      type: "theme_updated",
      category: "theme",
      timestamp: new Date(now - 5 * MIN).toISOString(),
      actor: { username: "j.rivera", role: "administrator", ip: "203.0.113.9" },
      target: { theme: "astra", name: "Astra" },
      changes: { from: "4.6.0", to: "4.6.1" },
    },
  ];
}

/**
 * Create the demo websites as fully connected sites, then run their events
 * through the real ingest pipeline — demo data exercises the production path.
 */
export async function generateDemoData({ now = Date.now() } = {}) {
  const staleLastSeen = {
    site_demo_copper: now - 2 * MIN,
    site_demo_cenexel: now - 24 * MIN, // shows "Connection Issue"
  };

  for (const spec of DEMO_SITE_SPECS) {
    const record = createSiteRecord(spec);
    await createSite({
      ...record,
      id: spec.id,
      demo: true,
      connectionStatus: "connected",
      monitoringStatus: "active",
      connectedAt: now - 26 * 3_600_000,
      lastSeenAt: staleLastSeen[spec.id] ?? now - 2 * MIN,
      collectorVersion: "0.1.0",
      wordpress: {
        wordpressVersion: "6.8",
        phpVersion: "8.2",
        pluginVersion: "0.1.0",
        siteUrl: spec.url,
        homeUrl: spec.url,
        multisite: false,
        theme: { name: "Hello Elementor", version: "3.4.1" },
        plugins: { active: 24, inactive: 6 },
      },
    });

    // Pair it the same way a real site is paired.
    await issueConnectionCode(spec.id);
    const conn = await getConnection(spec.id);
    await redeemConnectionCode({ code: conn.code, siteUrl: spec.url });
  }

  const incidents = [];
  incidents.push(await ingestEvents(DEMO_SITE_SPECS[0].id, { events: compromiseEvents(now) }));
  incidents.push(await ingestEvents(DEMO_SITE_SPECS[1].id, { events: routineEvents(now) }));

  await updateSite(DEMO_SITE_SPECS[1].id, { lastSeenAt: staleLastSeen.site_demo_cenexel });

  return { sites: DEMO_SITE_SPECS.map((s) => s.id), ingest: incidents };
}
