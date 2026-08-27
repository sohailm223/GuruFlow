/**
 * Correlation engine — the "black box" brain.
 *
 * Input:  a chronological list of normalised events for one site.
 * Output: incidents, each with a likely cause, a risk level and the
 *         evidence chain that produced it.
 *
 * Design notes:
 *  - Pure functions, no I/O, so they are unit-testable and reusable from
 *    both the ingest route and the /analyze dry-run route.
 *  - Grouping is by time proximity (a burst of change), not by rule.
 *  - Rules then explain the burst.
 */

export const RISK_LEVELS = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

const DEFAULT_OPTS = {
  gapMinutes: 10, // new incident after this much silence
  maxWindowHours: 6, // hard cap on one incident window
};

/* ------------------------------------------------------------------ *
 * 1. Group events into incidents (time proximity)
 * ------------------------------------------------------------------ */

export function groupIntoIncidents(events, opts = {}) {
  const { gapMinutes, maxWindowHours } = { ...DEFAULT_OPTS, ...opts };
  const sorted = [...events].sort((a, b) => a.at - b.at);

  const incidents = [];
  let current = null;

  for (const e of sorted) {
    const gap = current ? e.at - current.events[current.events.length - 1].at : Infinity;
    const span = current ? e.at - current.events[0].at : 0;

    const startsNew =
      !current ||
      gap > gapMinutes * 60_000 ||
      span > maxWindowHours * 3_600_000;

    if (startsNew) {
      current = { events: [e] };
      incidents.push(current);
    } else {
      current.events.push(e);
    }
  }

  return incidents.map((group) => analyzeIncident(group.events));
}

/* ------------------------------------------------------------------ *
 * 2. Analyze one incident: score it, explain it, pick a headline
 * ------------------------------------------------------------------ */

export function analyzeIncident(incidentEvents) {
  const events = [...incidentEvents].sort((a, b) => a.at - b.at);
  const scored = events.map(scoreEvent).sort((a, b) => b.score - a.score);

  const findings = detectPatterns(events);
  const patternScore = findings.reduce((sum, f) => sum + f.weight, 0);
  const eventScore = scored.reduce((sum, s) => sum + s.score, 0);
  const total = eventScore + patternScore;

  const risk = riskFromScore(total);
  const headline = pickHeadline(findings, scored);
  const suspectEvents = scored
    .filter((s) => s.score > 0)
    .slice(0, 6)
    .map((s) => s.event);

  return {
    events,
    startedAt: events[0]?.at ?? null,
    endedAt: events[events.length - 1]?.at ?? null,
    durationMinutes: events.length
      ? Math.round((events[events.length - 1].at - events[0].at) / 60_000)
      : 0,
    eventCount: events.length,
    categories: uniqueSorted(events.map((e) => e.category)),
    risk,
    score: total,
    headline: headline?.headline ?? "Routine site activity",
    likelyCause: headline?.cause ?? "No suspicious pattern detected in this window.",
    findings,
    evidence: headline?.evidence ?? [],
    suspectEvents,
    timeline: events.map((e) => ({
      at: e.at,
      category: e.category,
      type: e.type,
      score: scoreEvent(e).score,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * 3. Per-event risk scoring
 * ------------------------------------------------------------------ */

/** Directories where executable code should never appear. */
export const SUSPICIOUS_PATHS = [
  "/wp-content/uploads/",
  "/wp-includes/",
  "/wp-content/upgrade/",
  "/wp-content/cache/",
  "/tmp/",
];

export function isSuspiciousPath(path) {
  if (!path) return false;
  const p = path.startsWith("/") ? path : `/${path}`;
  return SUSPICIOUS_PATHS.some((bad) => p.includes(bad));
}

export function scoreEvent(e) {
  const flags = [];
  let score = 0;

  const add = (points, why) => {
    score += points;
    flags.push(why);
  };

  switch (e.type) {
    case "file.created":
      if (/\.(php|phtml|phar|pl|py|sh|cgi)$/i.test(e.path ?? "")) {
        add(45, "New executable file created");
      } else {
        add(6, "New file created");
      }
      if (isSuspiciousPath(e.path)) add(30, "Inside a directory that should be data-only");
      break;

    case "file.modified":
      if (isSuspiciousPath(e.path)) add(20, "Modified file in a sensitive directory");
      if (/wp-(config\.php|settings\.php|load\.php|admin\/includes)/i.test(e.path ?? "")) {
        add(25, "Core bootstrap file modified");
      }
      break;

    case "file.deleted":
      add(10, "File deleted");
      break;

    case "files.changed":
      add(Math.min(20, Math.ceil((e.count ?? 0) / 10)), `${e.count ?? 0} files changed at once`);
      break;

    case "user.created":
      if (/admin/i.test(e.to ?? "")) add(35, "New administrator account");
      else add(12, "New user account");
      break;

    case "user.role_changed":
      if (/admin/i.test(e.to ?? "")) add(30, "Account escalated to administrator");
      else add(10, "User role changed");
      break;

    case "user.deleted":
      add(8, "User deleted");
      break;

    case "wpconfig.modified":
      add(30, "wp-config.php modified");
      break;

    case "htaccess.modified":
      add(22, ".htaccess modified");
      break;

    case "db.option_changed": {
      const sensitive = /^(siteurl|home|admin_email|active_plugins|template|stylesheet|users_can_register|default_role)$/i;
      if (sensitive.test(e.target ?? "")) add(25, `Security-sensitive option changed (${e.target})`);
      else add(6, "wp_options modified");
      break;
    }

    case "cron.created":
      add(12, "Scheduled job added (common persistence trick)");
      break;

    case "redirect.added":
      add(18, "Redirect added (traffic hijacking risk)");
      break;

    case "smtp.settings_changed":
      add(15, "SMTP settings changed (phishing/spam risk)");
      break;

    case "dns.record_changed":
      add(28, "DNS record changed (traffic hijacking risk)");
      break;

    case "ssl.invalid":
      add(20, "SSL certificate invalid");
      break;
    case "ssl.expiring":
      add(5, "SSL certificate expiring");
      break;

    case "admin_login.failed":
      add(Math.min(20, 5 + (e.count ?? 1)), `Failed admin login${e.count > 1 ? ` ×${e.count}` : ""}`);
      break;

    case "admin_login.success":
      add(5, "Admin login");
      if (e.meta?.newLocation) add(12, "Login from a new location");
      break;

    case "site.error_burst":
      add(18, "Site started returning errors (impact)");
      break;

    case "plugin.updated":
    case "theme.updated":
    case "core.updated":
      add(4, `${e.type.split(".")[0]} update`);
      break;

    case "plugin.installed":
    case "theme.installed":
      add(12, `New ${e.type.split(".")[0]} installed`);
      break;

    case "plugin.activated":
      add(8, "Plugin activated");
      break;
    case "plugin.deactivated":
      add(6, "Plugin deactivated");
      break;
    case "plugin.deleted":
      add(8, "Plugin deleted");
      break;

    default:
      add(2, e.type);
  }

  // An actor on otherwise-ordinary events still matters.
  if (e.actor?.name && e.actor.name !== "system") add(2, "Attributed to a user");

  return { event: e, score, flags };
}

/* ------------------------------------------------------------------ *
 * 4. Pattern detection — this is what produces "Likely Cause"
 * ------------------------------------------------------------------ */

export function detectPatterns(events) {
  const findings = [];
  const has = (t) => events.filter((e) => e.type === t);
  const between = (a, b, maxMinutes) => b.at - a.at >= 0 && b.at - a.at <= maxMinutes * 60_000;

  const adminCreated = has("user.created").filter((e) => /admin/i.test(e.to ?? ""));
  const roleEscalated = has("user.role_changed").filter((e) => /admin/i.test(e.to ?? ""));
  const phpUploads = has("file.created").filter(
    (e) => /\.(php|phtml|phar)$/i.test(e.path ?? "") && isSuspiciousPath(e.path)
  );
  const optionChanges = has("db.option_changed");
  const errorBursts = has("site.error_burst");
  const updates = [...has("plugin.updated"), ...has("theme.updated"), ...has("core.updated")];
  const installs = [...has("plugin.installed"), ...has("theme.installed")];
  const cronAdded = has("cron.created");
  const redirects = has("redirect.added");
  const smtpChanged = has("smtp.settings_changed");
  const htaccess = has("htaccess.modified");
  const failedLogins = has("admin_login.failed");

  // --- A. Privilege escalation → backdoor (the classic compromise) ---
  const privEvent = adminCreated[0] ?? roleEscalated[0];
  const backdoor = phpUploads[0];
  if (privEvent && backdoor) {
    findings.push({
      id: "priv-esc-then-backdoor",
      weight: 60,
      headline: "Backdoor planted after privilege escalation",
      cause:
        "Suspicious administrator activity — a new administrator account appeared and an executable PHP file was written into a data-only directory.",
      evidence: [privEvent, ...(optionChanges.length ? [optionChanges[0]] : []), backdoor].filter(Boolean),
    });
  } else if (backdoor) {
    findings.push({
      id: "webshell-upload",
      weight: 45,
      headline: "Executable file written into uploads",
      cause: `A PHP file appeared at ${backdoor.path}. That directory should only ever hold images and documents, so this is very likely a webshell.`,
      evidence: [backdoor],
    });
  } else if (privEvent) {
    findings.push({
      id: "priv-esc",
      weight: 30,
      headline: "Unexpected administrator account",
      cause: `An administrator account (${privEvent.target ?? "unknown"}) was created or escalated. If nobody on your team did this, treat it as a compromise.`,
      evidence: [privEvent],
    });
  }

  // --- B. Update → immediate breakage ---
  const firstUpdate = updates[0];
  if (firstUpdate && errorBursts[0] && between(firstUpdate, errorBursts[0], 30)) {
    findings.push({
      id: "update-then-breakage",
      weight: 35,
      headline: "Site broke shortly after an update",
      cause: `Errors began ${Math.round(
        (errorBursts[0].at - firstUpdate.at) / 60_000
      )} minutes after ${describeShort(firstUpdate)}. Roll back that component first.`,
      evidence: [firstUpdate, errorBursts[0]],
    });
  } else if (installs[0] && errorBursts[0] && between(installs[0], errorBursts[0], 30)) {
    findings.push({
      id: "install-then-breakage",
      weight: 30,
      headline: "Site broke shortly after a new component was installed",
      cause: `Errors began after ${describeShort(installs[0])} was installed. Deactivate it to confirm.`,
      evidence: [installs[0], errorBursts[0]],
    });
  }

  // --- C. Traffic hijacking ---
  const hijackEvidence = [redirects[0], htaccess[0], optionChanges.find((e) => /^(siteurl|home)$/i.test(e.target ?? "")), smtpChanged[0]].filter(Boolean);
  if (hijackEvidence.length >= 2) {
    findings.push({
      id: "traffic-hijack",
      weight: 40,
      headline: "Traffic or mail being redirected",
      cause: "Multiple delivery paths changed together (redirects, .htaccess, site URL or SMTP). This pattern is used to send visitors and mail somewhere else.",
      evidence: hijackEvidence,
    });
  }

  // --- D. Persistence ---
  if (cronAdded[0] && (backdoor || privEvent)) {
    findings.push({
      id: "persistence",
      weight: 20,
      headline: "Persistence mechanism installed",
      cause: `A cron job was scheduled in the same window as other suspicious activity — commonly how malware survives a cleanup.`,
      evidence: [cronAdded[0]],
    });
  }

  // --- E. Brute force ---
  const attempts = failedLogins.reduce((n, e) => n + (e.count ?? 1), 0);
  if (attempts >= 10) {
    findings.push({
      id: "brute-force",
      weight: 15,
      headline: "Login attack in progress",
      cause: `${attempts} failed administrator logins in this window.`,
      evidence: failedLogins.slice(0, 3),
    });
  }

  // --- F. Config tampering on its own ---
  if (!findings.length && (htaccess[0] || optionChanges.length)) {
    findings.push({
      id: "config-tamper",
      weight: 15,
      headline: "Configuration changed",
      cause: "Configuration was modified with no matching deployment activity.",
      evidence: [htaccess[0], ...optionChanges.slice(0, 2)].filter(Boolean),
    });
  }

  // --- G. Quiet window ---
  if (!findings.length && updates.length) {
    findings.push({
      id: "routine-maintenance",
      weight: 0,
      headline: "Routine maintenance",
      cause: "Only expected update activity was observed in this window.",
      evidence: updates.slice(0, 2),
    });
  }

  return findings.sort((a, b) => b.weight - a.weight);
}

function riskFromScore(score) {
  if (score >= 100) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  if (score >= 10) return "LOW";
  return "INFO";
}

function pickHeadline(findings, scored) {
  const top = findings[0];
  if (top) {
    return {
      headline: top.headline,
      cause: top.cause,
      evidence: top.evidence,
    };
  }
  const topEvent = scored[0];
  if (!topEvent) return null;
  return {
    headline: "Single change observed",
    cause: describeShort(topEvent.event),
    evidence: [topEvent.event],
  };
}

function describeShort(e) {
  const ver = e.from && e.to ? ` ${e.from} → ${e.to}` : "";
  const label = e.target ?? e.path ?? e.type;
  return `${e.type.split(".").pop()} "${label}"${ver}`;
}

function uniqueSorted(arr) {
  return [...new Set(arr.filter(Boolean))].sort();
}
