/**
 * Demo scenario: the exact compromise timeline from the product brief.
 *
 * Used by POST /api/blackbox/demo so the Black Box can be evaluated without a
 * live WordPress site attached. Timestamps are generated relative to "now" so
 * the timeline always looks fresh.
 */

export const DEMO_SITE = "https://demo-shop.example";

const MIN = 60_000;

export function buildDemoEvents(now = Date.now()) {
  const t0 = now - 14 * MIN; // 11:03 AM anchor

  return [
    {
      type: "plugin.updated",
      category: "plugin",
      at: t0,
      target: "Elementor Pro",
      from: "3.28.1",
      to: "3.29.0",
      actor: { name: "auto-updater", role: "system" },
    },
    {
      type: "files.changed",
      category: "file",
      at: t0 + 2 * MIN,
      path: "/wp-content/plugins/elementor-pro",
      count: 47,
    },
    {
      type: "user.created",
      category: "user",
      at: t0 + 3 * MIN,
      target: "support_wp",
      to: "administrator",
      actor: { name: "support_wp", ip: "185.220.101.44" },
      sourceIp: "185.220.101.44",
    },
    {
      type: "db.option_changed",
      category: "db",
      at: t0 + 5 * MIN,
      target: "active_plugins",
      actor: { name: "support_wp", role: "administrator" },
    },
    {
      type: "file.created",
      category: "file",
      at: t0 + 9 * MIN,
      path: "/wp-content/uploads/cache/x1.php",
      meta: { executable: true, bytes: 4311 },
      actor: { name: "support_wp", role: "administrator" },
    },
    {
      type: "cron.created",
      category: "cron",
      at: t0 + 10 * MIN,
      target: "wp_health_check_hourly",
      actor: { name: "support_wp", role: "administrator" },
    },
    {
      type: "site.error_burst",
      category: "core",
      at: t0 + 11 * MIN,
      meta: { httpStatus: 500, requests: 312 },
    },
  ];
}
