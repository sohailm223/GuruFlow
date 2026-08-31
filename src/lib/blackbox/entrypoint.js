/**
 * Likely infection path.
 *
 * Turns the events in one incident into a *hedged* hypothesis about how the
 * site got into this state: a likely entry point, the evidence for it, and the
 * chain from entry to impact.
 *
 * Language rules, deliberately strict:
 *   - "Likely entry point" / "possible" / "may be involved" — never "was infected
 *     through the admin password". ScanSite sees events, not credentials, and
 *     cannot prove how access was obtained.
 *   - Every reason cites a real event, and every chain step exists only if an
 *     event supports it. No step is invented to complete a story.
 *   - Confidence is derived from the signals below and capped at 90 — an
 *     unverified hypothesis is never presented as certain.
 *
 * ScanSite does not consult a vulnerability database, cannot see credentials,
 * and never executes or matches code against signatures. Labels therefore stay
 * descriptive of the *activity* observed: "Possible plugin-related entry point"
 * rather than "Vulnerable Plugin", "Possible application-password misuse"
 * rather than "Stolen Application Password". A classification means recorded
 * activity correlates with this incident — nothing about vulnerability,
 * maliciousness or credential theft is asserted.
 */

import { isExecutablePath, isSuspiciousPath } from "./scoring.js";

const MINUTE = 60_000;

/** The classifications ScanSite can produce. */
export const ENTRY_POINT_TYPES = [
  { id: "compromised_admin", label: "Possible account compromise" },
  { id: "vulnerable_plugin", label: "Possible plugin-related entry point" },
  { id: "vulnerable_theme", label: "Possible theme-related entry point" },
  { id: "stolen_application_password", label: "Possible application-password misuse" },
  { id: "malicious_plugin_install", label: "Suspicious plugin installation" },
  { id: "unexpected_file_upload", label: "Unexpected File Upload" },
  { id: "configuration_hijack", label: "Configuration or redirect change" },
  { id: "brute_force_login", label: "Brute-force Login" },
  { id: "unknown", label: "Unknown Entry Point" },
];

const byType = (events, ...types) => events.filter((e) => types.includes(e.type));
const pathOf = (e) => e.path ?? e.target?.path ?? e.metadata?.file?.relativePath;
const nameOf = (e) => e.target?.name ?? e.target?.plugin ?? e.target?.theme ?? e.target?.username ?? null;
const minutesBetween = (a, b) => Math.max(1, Math.round((b.timestamp - a.timestamp) / MINUTE));

function ipReason(e, knownIps) {
  const ip = e.actor?.ip;
  if (!ip) return null;
  if (knownIps && !knownIps.has(ip)) {
    return { text: `Activity came from IP ${ip}, which does not appear in this site's earlier events`, eventId: e.eventId };
  }
  return { text: `Activity came from IP ${ip}`, eventId: e.eventId };
}

/** True when the same actor or IP links two events. */
function sameActor(a, b) {
  if (!a || !b) return false;
  return Boolean(
    (a.actor?.username && a.actor.username === b.actor?.username) ||
      (a.actor?.ip && a.actor.ip === b.actor?.ip)
  );
}

function adminEscalation(events) {
  return (
    byType(events, "administrator_created")[0] ??
    byType(events, "user_role_changed").find((e) => /admin/i.test(e.changes?.to ?? "")) ??
    byType(events, "user_created").find((e) => /admin/i.test(e.changes?.to ?? "")) ??
    null
  );
}

function suspiciousExecutable(events) {
  return (
    byType(events, "executable_created", "unexpected_executable", "file_created").find((e) => {
      const p = pathOf(e);
      return p && isExecutablePath(p) && isSuspiciousPath(p);
    }) ?? null
  );
}

/* ------------------------------------------------------------ candidates */

function compromisedAdmin(events, knownIps) {
  const priv = adminEscalation(events);
  if (!priv) return null;

  const account = priv.target?.username ?? priv.target?.name ?? priv.actor?.username ?? "an administrator account";
  const reasons = [{ text: `New administrator access appeared (${account})`, eventId: priv.eventId }];
  const chain = [
    { label: "Unknown Login / Account", detail: priv.actor?.username ? `actor ${priv.actor.username}` : "account activity", eventId: priv.eventId },
    { label: "Administrator Access", detail: account, eventId: priv.eventId },
  ];
  let score = 40;

  const ipReason_ = ipReason(priv, knownIps);
  if (ipReason_) reasons.push(ipReason_);

  const exe = suspiciousExecutable(events);
  if (exe && exe.timestamp >= priv.timestamp) {
    score += 15;
    if (sameActor(priv, exe)) score += 10;
    reasons.push({
      text: `PHP executable appeared ${minutesBetween(priv, exe)} minutes later at ${pathOf(exe)}`,
      eventId: exe.eventId,
    });
    chain.push({ label: "Unexpected PHP File", detail: pathOf(exe), eventId: exe.eventId });
  }

  const cron = byType(events, "cron_added").find((e) => e.timestamp >= priv.timestamp);
  if (cron) {
    score += 10;
    if (sameActor(priv, cron)) score += 5;
    reasons.push({ text: `New cron job followed (${cron.target?.hook ?? cron.target?.name ?? "unknown hook"})`, eventId: cron.eventId });
    chain.push({ label: "Cron Persistence", detail: cron.target?.hook ?? null, eventId: cron.eventId });
  }

  const errors = byType(events, "site_error_burst").find((e) => e.timestamp >= priv.timestamp);
  if (errors) {
    score += 8;
    reasons.push({ text: "Website errors started immediately afterward", eventId: errors.eventId });
    chain.push({ label: "Website Failure", detail: `HTTP ${errors.metadata?.httpStatus ?? 500}`, eventId: errors.eventId });
  }

  return {
    id: "compromised_admin",
    label: "Possible account compromise",
    headline: "Possible compromised administrator access",
    score,
    reasons,
    chain,
    target: { kind: "account", username: account, eventId: priv.eventId },
  };
}

function componentChanged(events, kind) {
  const isPlugin = kind === "plugin";
  const mismatch = byType(events, isPlugin ? "plugin_file_mismatch" : "theme_file_mismatch")[0];
  const updated = byType(events, isPlugin ? "plugin_updated" : "theme_updated")[0];
  const toggled = isPlugin ? byType(events, "active_plugins_changed")[0] : null;
  const anchor = mismatch ?? updated ?? toggled;
  if (!anchor) return null;

  const name = anchor.target?.name ?? anchor.target?.plugin ?? anchor.target?.theme ?? (isPlugin ? "a plugin" : "a theme");
  const version = anchor.changes?.from ?? null;
  const reasons = [];
  const chain = [{ label: isPlugin ? "Plugin Activity" : "Theme Activity", detail: `${name}${version ? ` ${version}` : ""}`, eventId: anchor.eventId }];
  let score = mismatch ? 47 : 32;

  if (mismatch) reasons.push({ text: `${isPlugin ? "Plugin" : "Theme"} files changed unexpectedly (${name})`, eventId: mismatch.eventId });
  else if (updated) reasons.push({ text: `${isPlugin ? "Plugin" : "Theme"} "${name}" was updated${anchor.changes?.from ? ` from ${anchor.changes.from}` : ""}`, eventId: updated.eventId });
  else reasons.push({ text: `The set of active plugins changed around this time`, eventId: toggled.eventId });

  const exe = suspiciousExecutable(events);
  if (exe) {
    score += 12;
    reasons.push({ text: `An unexpected PHP file appeared at ${pathOf(exe)}`, eventId: exe.eventId });
    chain.push({ label: "Unknown PHP", detail: pathOf(exe), eventId: exe.eventId });
  }
  const cron = byType(events, "cron_added")[0];
  if (cron) {
    score += 8;
    chain.push({ label: "Cron", detail: cron.target?.hook ?? null, eventId: cron.eventId });
  }
  const redirect = byType(events, "redirect_created", "unexpected_redirect")[0];
  if (redirect) {
    score += 8;
    chain.push({ label: "Redirect", detail: nameOf(redirect), eventId: redirect.eventId });
  }
  const errors = byType(events, "site_error_burst")[0];
  if (errors) {
    score += 10;
    reasons.push({ text: "Website errors followed the change", eventId: errors.eventId });
    chain.push({ label: "Website Failure", detail: `HTTP ${errors.metadata?.httpStatus ?? 500}`, eventId: errors.eventId });
  }

  return {
    id: isPlugin ? "vulnerable_plugin" : "vulnerable_theme",
    label: isPlugin ? "Possible plugin-related entry point" : "Possible theme-related entry point",
    headline: mismatch
      ? `${isPlugin ? "Plugin" : "Theme"} files changed unexpectedly`
      : `Outdated ${isPlugin ? "plugin" : "theme"} may be involved`,
    score,
    reasons,
    chain,
    target: { kind, name, version, eventId: anchor.eventId },
  };
}

function applicationPassword(events, knownIps) {
  const anchor =
    byType(events, "application_password_created")[0] ??
    byType(events, "application_password_deleted")[0] ??
    null;
  if (!anchor) return null;

  const reasons = [
    anchor.type === "application_password_created"
      ? { text: `An application password was created${anchor.actor?.username ? ` by ${anchor.actor.username}` : ""}`, eventId: anchor.eventId }
      : { text: `An application password was removed${anchor.actor?.username ? ` by ${anchor.actor.username}` : ""}`, eventId: anchor.eventId },
  ];
  const ip = ipReason(anchor, knownIps);
  if (ip) reasons.push(ip);

  let score = 34;
  const chain = [{ label: "Application Password", detail: nameOf(anchor), eventId: anchor.eventId }];

  const exe = suspiciousExecutable(events);
  if (exe) {
    score += 12;
    reasons.push({ text: `An unexpected PHP file appeared at ${pathOf(exe)}`, eventId: exe.eventId });
    chain.push({ label: "Unknown PHP", detail: pathOf(exe), eventId: exe.eventId });
  }
  const cron = byType(events, "cron_added")[0];
  if (cron) {
    score += 8;
    chain.push({ label: "Cron", detail: cron.target?.hook ?? null, eventId: cron.eventId });
  }

  return {
    id: "stolen_application_password",
    label: "Possible application-password misuse",
    headline: "Application password activity may be involved",
    score,
    reasons,
    chain,
    target: { kind: "application_password", name: nameOf(anchor), eventId: anchor.eventId },
  };
}

function maliciousInstall(events) {
  const installed = byType(events, "plugin_installed")[0];
  if (!installed) return null;

  const name = installed.target?.name ?? installed.target?.plugin ?? "a plugin";
  const reasons = [{ text: `Plugin "${name}" was installed in this window`, eventId: installed.eventId }];
  const chain = [{ label: "Plugin Installed", detail: name, eventId: installed.eventId }];
  let score = 30;

  const exe = suspiciousExecutable(events);
  if (exe && exe.timestamp >= installed.timestamp) {
    score += 18;
    reasons.push({ text: `An unexpected PHP file appeared ${minutesBetween(installed, exe)} minutes later at ${pathOf(exe)}`, eventId: exe.eventId });
    chain.push({ label: "Unknown PHP", detail: pathOf(exe), eventId: exe.eventId });
  }
  const cron = byType(events, "cron_added").find((e) => e.timestamp >= installed.timestamp);
  if (cron) {
    score += 10;
    reasons.push({ text: `A cron job was registered afterward (${cron.target?.hook ?? "unknown hook"})`, eventId: cron.eventId });
    chain.push({ label: "Cron Persistence", detail: cron.target?.hook ?? null, eventId: cron.eventId });
  }
  const errors = byType(events, "site_error_burst")[0];
  if (errors) {
    score += 8;
    chain.push({ label: "Website Failure", detail: `HTTP ${errors.metadata?.httpStatus ?? 500}`, eventId: errors.eventId });
  }

  // Only a real candidate when something else followed the install.
  if (score < 40) return null;

  return {
    id: "malicious_plugin_install",
    label: "Suspicious plugin installation",
    headline: "A newly installed plugin may be involved",
    score,
    reasons,
    chain,
    target: { kind: "plugin", name, version: installed.changes?.to ?? null, eventId: installed.eventId },
  };
}

function unexpectedUpload(events) {
  const exe = suspiciousExecutable(events);
  if (!exe) return null;

  const p = pathOf(exe);
  const reasons = [{ text: `Executable PHP appeared at ${p}, a directory that should only hold media`, eventId: exe.eventId }];
  const chain = [{ label: "Unexpected File Upload", detail: p, eventId: exe.eventId }];
  let score = 45;

  if (exe.actor?.username) reasons.push({ text: `The write is attributed to ${exe.actor.username}`, eventId: exe.eventId });
  const ip = ipReason(exe, null);
  if (ip) reasons.push(ip);

  const cron = byType(events, "cron_added")[0];
  if (cron) {
    score += 10;
    chain.push({ label: "Cron Persistence", detail: cron.target?.hook ?? null, eventId: cron.eventId });
  }
  const redirect = byType(events, "redirect_created", "unexpected_redirect")[0];
  if (redirect) {
    score += 8;
    chain.push({ label: "Redirect", detail: nameOf(redirect), eventId: redirect.eventId });
  }
  const errors = byType(events, "site_error_burst")[0];
  if (errors) {
    score += 6;
    chain.push({ label: "Website Failure", detail: `HTTP ${errors.metadata?.httpStatus ?? 500}`, eventId: errors.eventId });
  }

  return {
    id: "unexpected_file_upload",
    label: "Unexpected File Upload",
    headline: "Unexpected executable file in a data-only directory",
    score,
    reasons,
    chain,
    target: { kind: "file", path: p, eventId: exe.eventId },
  };
}

function configurationHijack(events) {
  const anchor =
    byType(events, "siteurl_changed")[0] ??
    byType(events, "home_changed")[0] ??
    byType(events, "htaccess_modified")[0] ??
    byType(events, "wp_config_modified")[0] ??
    byType(events, "unexpected_redirect")[0] ??
    byType(events, "redirect_created")[0] ??
    null;
  if (!anchor) return null;

  const reasons = [];
  const chain = [];
  let score = 40;

  if (anchor.type === "siteurl_changed" || anchor.type === "home_changed") {
    reasons.push({ text: `The site URL changed to ${anchor.changes?.to ?? "an unknown value"}`, eventId: anchor.eventId });
    chain.push({ label: "Configuration Changed", detail: anchor.changes?.to ?? null, eventId: anchor.eventId });
  } else if (anchor.type === "htaccess_modified" || anchor.type === "wp_config_modified") {
    reasons.push({ text: `${anchor.type === "htaccess_modified" ? ".htaccess" : "wp-config.php"} was modified`, eventId: anchor.eventId });
    chain.push({ label: "Configuration File Changed", detail: anchor.type === "htaccess_modified" ? ".htaccess" : "wp-config.php", eventId: anchor.eventId });
  } else {
    reasons.push({ text: `A redirect was created${nameOf(anchor) ? ` (${nameOf(anchor)})` : ""}`, eventId: anchor.eventId });
    chain.push({ label: "Redirect Created", detail: nameOf(anchor), eventId: anchor.eventId });
  }

  const smtp = byType(events, "smtp_setting_changed")[0];
  if (smtp) {
    score += 10;
    reasons.push({ text: "Mail settings changed in the same window", eventId: smtp.eventId });
    chain.push({ label: "Mail Settings", detail: null, eventId: smtp.eventId });
  }
  const mailFail = byType(events, "mail_failure")[0];
  if (mailFail) {
    score += 6;
    chain.push({ label: "Mail Failure", detail: null, eventId: mailFail.eventId });
  }
  const errors = byType(events, "site_error_burst")[0];
  if (errors) {
    score += 6;
    chain.push({ label: "Website Failure", detail: `HTTP ${errors.metadata?.httpStatus ?? 500}`, eventId: errors.eventId });
  }

  return {
    id: "configuration_hijack",
    label: "Configuration or redirect change",
    headline: "Site configuration or redirects were changed",
    score,
    reasons,
    chain,
    target: { kind: "config", name: nameOf(anchor), eventId: anchor.eventId },
  };
}

function bruteForce(events) {
  const burst = byType(events, "login_failed_burst")[0];
  if (!burst) return null;

  const reasons = [
    {
      text: `${burst.count ?? "Many"} failed logins in ${burst.metadata?.windowMinutes ?? "a short"} minutes against ${burst.target?.username ?? "an account"}`,
      eventId: burst.eventId,
    },
  ];
  const chain = [{ label: "Brute-force Login", detail: burst.target?.username ?? null, eventId: burst.eventId }];
  let score = 33;

  if (burst.metadata?.ipCount) reasons.push({ text: `${burst.metadata.ipCount} different IP addresses were involved`, eventId: burst.eventId });

  const success = byType(events, "login_success").find((e) => e.timestamp >= burst.timestamp);
  if (success) {
    score += 18;
    reasons.push({ text: `A successful login followed at ${new Date(success.timestamp).toISOString()}`, eventId: success.eventId });
    chain.push({ label: "Successful Login", detail: success.actor?.username ?? null, eventId: success.eventId });
  }
  const priv = adminEscalation(events);
  if (priv) {
    score += 10;
    chain.push({ label: "Administrator Access", detail: priv.target?.username ?? null, eventId: priv.eventId });
  }

  return {
    id: "brute_force_login",
    label: "Brute-force Login",
    headline: "Brute-force login attempts against this site",
    score,
    reasons,
    chain,
    target: { kind: "account", username: burst.target?.username ?? null, eventId: burst.eventId },
  };
}

/**
 * Classify an incident's likely entry point.
 *
 * @param {Array}  events             events in this incident, oldest first
 * @param {object} opts.knownIps      Set of IPs seen in this site's earlier
 *                                    events — lets a reason say "not seen before"
 *                                    only when that is actually verifiable.
 */
export function classifyEntryPoint(events, { knownIps = null } = {}) {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  const candidates = [
    compromisedAdmin(sorted, knownIps),
    componentChanged(sorted, "plugin"),
    componentChanged(sorted, "theme"),
    applicationPassword(sorted, knownIps),
    maliciousInstall(sorted),
    configurationHijack(sorted),
    bruteForce(sorted),
    unexpectedUpload(sorted),
  ]
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) {
    return {
      id: "unknown",
      label: "Unknown Entry Point",
      headline: "Entry point not identified",
      confidence: 0,
      confidenceLabel: "Uncertain",
      reasons: [
        { text: "Nothing in this window identifies how the activity started", eventId: null },
        { text: `ScanSite recorded ${sorted.length} event${sorted.length === 1 ? "" : "s"} here, none of which point at an entry point`, eventId: null },
      ],
      chain: [],
      target: null,
      candidates: [],
    };
  }

  const best = candidates[0];
  const runnerUp = candidates[1];

  // Confidence: the raw signal strength scaled down, capped below certainty.
  let confidence = Math.round(best.score * 0.9);
  const caveats = [];

  // Two explanations fitting almost equally well is itself evidence of doubt.
  if (runnerUp && best.score - runnerUp.score <= 10) {
    confidence -= 12;
    caveats.push(`"${runnerUp.label}" fits this window almost as well`);
  }
  if (best.reasons.length <= 2) {
    confidence -= 8;
    caveats.push("only one or two signals support this");
  }

  confidence = Math.max(25, Math.min(90, confidence));

  return {
    id: best.id,
    label: best.label,
    headline: best.headline,
    confidence,
    confidenceLabel: confidenceLabelFor(confidence),
    reasons: best.reasons,
    caveats,
    chain: best.chain,
    target: best.target,
    // Kept for the developer diagnostics panel, never rendered as fact.
    candidates: candidates.slice(0, 4).map((c) => ({ id: c.id, label: c.label, score: c.score })),
  };
}

function confidenceLabelFor(c) {
  if (c >= 75) return "Likely";
  if (c >= 55) return "Possible";
  if (c >= 35) return "Speculative";
  return "Uncertain";
}
