/**
 * Pattern detectors.
 *
 * Each detector is a pure function: events in → findings out. A finding is
 * { id, weight, title, cause, evidence, concepts }, where `concepts` sorts the
 * evidence into the four separated ideas the UI shows:
 *
 *   cause — why this happened
 *   change — what was actually done to the site
 *   persistence — how it survives
 *   impact — what it broke
 *
 * These are the same seven detectors as the original Black Box iteration,
 * rewritten against the normalised event shape. The scoring weights are
 * unchanged so existing incidents keep their verdicts.
 */

import { isSuspiciousPath, isExecutablePath } from "../scoring";

const MINUTE = 60_000;

function within(a, b, minutes) {
  return b.timestamp - a.timestamp >= 0 && b.timestamp - a.timestamp <= minutes * MINUTE;
}

const byType = (events, ...types) => events.filter((e) => types.includes(e.type));
const first = (arr) => arr[0];

function ev(e, role, note) {
  if (!e) return null;
  return { eventId: e.eventId, type: e.type, timestamp: e.timestamp, role, note };
}

const compact = (arr) => arr.filter(Boolean);

/* ------------------------------------------------------------------ *
 * 1. Privilege escalation → backdoor  (the classic compromise)
 * ------------------------------------------------------------------ */

export function detectPrivEscBackdoor(events) {
  const priv = first(
    compact([
      ...byType(events, "administrator_created"),
      ...byType(events, "user_created").filter((e) => /admin/i.test(e.changes?.to ?? "")),
      ...byType(events, "user_role_changed").filter((e) => /admin/i.test(e.changes?.to ?? "")),
    ])
  );

  const backdoor = first(
    byType(events, "executable_created", "file_created").filter(
      (e) => isExecutablePath(e.path ?? e.target?.path) && isSuspiciousPath(e.path ?? e.target?.path)
    )
  );

  if (priv && backdoor) {
    const minutes = Math.max(1, Math.round((backdoor.timestamp - priv.timestamp) / MINUTE));
    const option = first(byType(events, "option_changed", "active_plugins_changed"));

    return {
      id: "priv-esc-then-backdoor",
      weight: 60,
      title: "Backdoor planted after privilege escalation",
      cause: `A new administrator account appeared and ${minutes} minutes later an executable PHP file was written into a data-only directory.`,
      summary: `An administrator account was created and ${minutes} minutes later an executable PHP file appeared inside uploads.`,
      concepts: {
        cause: "Suspected unauthorized administrator access",
        change: "Executable PHP backdoor created",
        persistence: first(byType(events, "cron_added"))
          ? "Suspicious cron registered"
          : undefined,
        impact: first(byType(events, "site_error_burst"))
          ? "Website began returning HTTP errors"
          : undefined,
      },
      evidence: compact([
        ev(priv, "cause", "New administrator created"),
        ev(option, "change", "WordPress setting changed"),
        ev(backdoor, "change", "Executable PHP appeared in uploads"),
        ev(first(byType(events, "cron_added")), "persistence", "Suspicious cron added"),
        ev(first(byType(events, "site_error_burst")), "impact", "HTTP failure followed shortly afterward"),
      ]),
    };
  }

  if (backdoor) {
    return {
      id: "webshell-upload",
      weight: 45,
      title: "Executable file written into uploads",
      cause: `A PHP file appeared at ${backdoor.path ?? backdoor.target?.path}. That directory should only ever hold images and documents, so this is very likely a webshell.`,
      summary: "An executable PHP file was created in a directory that should never contain code.",
      concepts: { cause: "Unknown file write", change: "Executable PHP backdoor created" },
      evidence: compact([ev(backdoor, "change", "Executable PHP appeared in uploads")]),
    };
  }

  if (priv) {
    return {
      id: "priv-esc",
      weight: 30,
      title: "Unexpected administrator account",
      cause: `An administrator account (${
        priv.target?.username ?? priv.target?.name ?? "unknown"
      }) was created or escalated. If nobody on your team did this, treat it as a compromise.`,
      summary: "An administrator account was created or escalated without a matching deployment.",
      concepts: { cause: "Suspected unauthorized administrator access" },
      evidence: compact([ev(priv, "cause", "New administrator created")]),
    };
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * 2. Update → immediate breakage
 * ------------------------------------------------------------------ */

export function detectUpdateBreakage(events) {
  const errors = first(byType(events, "site_error_burst", "site_status_changed", "mail_failure"));
  if (!errors) return null;

  const update = first(
    byType(events, "plugin_updated", "theme_updated", "wordpress_updated")
  );
  const install = first(byType(events, "plugin_installed", "theme_installed"));

  const label = (e) => `${e.target?.name ?? e.target?.plugin ?? e.target?.theme ?? "component"}`;

  if (update && within(update, errors, 30)) {
    const mins = Math.max(1, Math.round((errors.timestamp - update.timestamp) / MINUTE));
    return {
      id: "update-then-breakage",
      weight: 35,
      title: "Site broke shortly after an update",
      cause: `Errors began ${mins} minutes after ${label(update)} was updated. Roll that component back first.`,
      summary: `The site started failing ${mins} minutes after ${label(update)} was updated.`,
      concepts: {
        cause: `${label(update)} update`,
        change: "Component updated",
        impact: "Website began returning errors",
      },
      evidence: compact([
        ev(update, "cause", `${label(update)} updated`),
        ev(errors, "impact", "Errors followed shortly afterward"),
      ]),
    };
  }

  if (install && within(install, errors, 30)) {
    const mins = Math.max(1, Math.round((errors.timestamp - install.timestamp) / MINUTE));
    return {
      id: "install-then-breakage",
      weight: 30,
      title: "Site broke shortly after a new component was installed",
      cause: `Errors began ${mins} minutes after ${label(install)} was installed. Deactivate it to confirm.`,
      summary: `The site started failing after ${label(install)} was installed.`,
      concepts: {
        cause: `${label(install)} installed`,
        change: "New component installed",
        impact: "Website began returning errors",
      },
      evidence: compact([
        ev(install, "cause", `${label(install)} installed`),
        ev(errors, "impact", "Errors followed shortly afterward"),
      ]),
    };
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * 3. Traffic / mail hijacking
 * ------------------------------------------------------------------ */

export function detectTrafficHijack(events) {
  const candidates = compact([
    ev(first(byType(events, "redirect_created", "redirect_modified", "unexpected_redirect")), "change", "Redirect added or changed"),
    ev(first(byType(events, "htaccess_modified")), "change", ".htaccess modified"),
    ev(first(byType(events, "siteurl_changed", "home_changed")), "change", "Site URL changed"),
    ev(first(byType(events, "smtp_setting_changed")), "change", "SMTP settings changed"),
  ]);

  if (candidates.length < 2) return null;

  return {
    id: "traffic-hijack",
    weight: 40,
    title: "Traffic or mail being redirected",
    cause: "Multiple delivery paths changed together — redirects, .htaccess, site URL or SMTP. This pattern is used to send visitors and mail somewhere else.",
    summary: "Several delivery paths changed in the same window.",
    concepts: {
      cause: "Configuration tampering",
      change: "Delivery paths redirected",
      impact: "Visitors or mail may be sent elsewhere",
    },
    evidence: candidates,
  };
}

/* ------------------------------------------------------------------ *
 * 4. Persistence
 * ------------------------------------------------------------------ */

export function detectPersistence(events) {
  const cron = first(byType(events, "cron_added", "cron_modified"));
  if (!cron) return null;

  const suspiciousElsewhere = events.some(
    (e) =>
      e.type === "administrator_created" ||
      e.type === "executable_created" ||
      (e.type === "file_created" && isExecutablePath(e.path)) ||
      e.type === "application_password_created" ||
      /admin/i.test(e.changes?.to ?? "")
  );
  if (!suspiciousElsewhere) return null;

  return {
    id: "persistence",
    weight: 20,
    title: "Persistence mechanism installed",
    cause: "A cron job was scheduled in the same window as other suspicious activity — commonly how malware survives a cleanup.",
    summary: "A scheduled job was registered alongside other suspicious changes.",
    concepts: { persistence: "Suspicious cron registered" },
    evidence: compact([ev(cron, "persistence", "Cron job registered")]),
  };
}

/* ------------------------------------------------------------------ *
 * 5. Brute force
 * ------------------------------------------------------------------ */

export function detectBruteForce(events) {
  const failures = byType(events, "login_failed");
  const bursts = byType(events, "login_failed_burst");

  const attempts =
    bursts.reduce((n, e) => n + (e.count ?? 0), 0) +
    failures.reduce((n, e) => n + (e.count ?? 1), 0);

  if (attempts < 10) return null;

  const ips = new Set(
    [...failures, ...bursts].map((e) => e.actor?.ip).filter(Boolean)
  );

  return {
    id: "brute-force",
    weight: 15,
    title: "Login attack in progress",
    cause: `${attempts} failed administrator logins in this window${
      ips.size ? ` from ${ips.size} IP${ips.size === 1 ? "" : "s"}` : ""
    }.`,
    summary: `${attempts} failed administrator logins were recorded.`,
    concepts: { cause: "Credential guessing", impact: "Administrator accounts under attack" },
    evidence: [...failures, ...bursts].slice(0, 3).map((e) => ev(e, "cause", "Failed administrator login")),
  };
}

/* ------------------------------------------------------------------ *
 * 6. Configuration tampering (no matching deployment)
 * ------------------------------------------------------------------ */

export function detectConfigTamper(events, findings) {
  if (findings.length) return null;

  const config = compact([
    ev(first(byType(events, "htaccess_modified", "wp_config_modified")), "change", "Configuration file modified"),
    ev(first(byType(events, "option_changed", "registration_setting_changed")), "change", "WordPress option changed"),
  ]);

  if (!config.length) return null;

  return {
    id: "config-tamper",
    weight: 15,
    title: "Configuration changed",
    cause: "Configuration was modified with no matching deployment activity.",
    summary: "Configuration changed without an accompanying update.",
    concepts: { change: "Configuration modified" },
    evidence: config,
  };
}

/* ------------------------------------------------------------------ *
 * 7. Routine maintenance
 * ------------------------------------------------------------------ */

export function detectRoutine(events, findings) {
  if (findings.length) return null;

  const updates = byType(events, "plugin_updated", "theme_updated", "wordpress_updated");
  if (!updates.length) return null;

  return {
    id: "routine-maintenance",
    weight: 0,
    title: "Routine maintenance",
    cause: "Only expected update activity was observed in this window.",
    summary: "Routine component updates with no suspicious follow-on activity.",
    concepts: { change: "Routine component updates" },
    evidence: updates.slice(0, 2).map((e) => ev(e, "change", "Routine update")),
  };
}

/** Ordered detector pipeline. */
export const DETECTORS = [
  detectPrivEscBackdoor,
  detectUpdateBreakage,
  detectTrafficHijack,
  detectPersistence,
  detectBruteForce,
  detectConfigTamper,
  detectRoutine,
];

export function runDetectors(events) {
  const found = [];
  for (const detect of DETECTORS) {
    const finding = detect(events, found);
    if (finding) found.push(finding);
  }
  return found.sort((a, b) => b.weight - a.weight);
}
