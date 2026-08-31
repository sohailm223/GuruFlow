/**
 * Remediation planning.
 *
 * Builds an incident-specific, prioritised fix plan plus a recurrence-prevention
 * list, and defines the post-fix verification checks.
 *
 * ScanSite NEVER performs these actions. Everything here is advice for a human:
 * no file is deleted, no account disabled, no option reverted, no plugin
 * reinstalled by this code. The contextual buttons in the UI open information
 * or guidance — they do not mutate the WordPress site.
 *
 * Every step is derived from evidence in the incident, so the plan names the
 * actual account, file path, cron hook or plugin involved instead of generic
 * advice.
 */

/** Collect the concrete things this incident touched. */
export function extractTargets(incident) {
  const events = incident.events ?? [];
  const accounts = new Set();
  const files = new Set();
  const hooks = new Set();
  const plugins = new Set();
  const themes = new Set();
  const config = [];

  for (const e of events) {
    if (["administrator_created", "user_created", "user_role_changed"].includes(e.type)) {
      const name = e.target?.username ?? e.target?.name ?? e.actor?.username;
      if (name) accounts.add(name);
    }
    if (e.type === "login_success" && e.actor?.username) accounts.add(e.actor.username);

    if (["executable_created", "unexpected_executable", "file_created", "suspicious_code_detected", "file_modified"].includes(e.type)) {
      const p = e.path ?? e.target?.path ?? e.metadata?.file?.relativePath;
      if (p && /\.php$/i.test(p)) files.add(p.replace(/^\//, ""));
    }
    if (e.type === "cron_added" || e.type === "cron_modified") {
      const hook = e.target?.hook ?? e.target?.name;
      if (hook) hooks.add(hook);
    }
    if (e.target?.plugin) plugins.add(e.target.plugin);
    if (e.target?.theme) themes.add(e.target.theme);
    if (["siteurl_changed", "home_changed", "htaccess_modified", "wp_config_modified"].includes(e.type)) config.push(e.type);
  }

  return {
    accounts: [...accounts],
    files: [...files].slice(0, 3),
    hooks: [...hooks],
    plugins: [...plugins],
    themes: [...themes],
    config: [...new Set(config)],
    applicationPasswords: events.some((e) => e.type === "application_password_created" || e.type === "application_password_deleted"),
  };
}

const item = (id, label, detail = null) => ({ id, label, detail });

/**
 * Prioritised fix plan for one incident.
 *
 * @returns {{difficulty: string, stepCount: number, priorities: Array, guided: Array}}
 */
export function buildRemediationPlan(incident) {
  const t = extractTargets(incident);
  const entry = incident.entryPoint ?? null;
  const priorities = [];

  if (t.accounts.length || entry?.target?.kind === "account") {
    const accounts = t.accounts.length ? t.accounts : [entry?.target?.username].filter(Boolean);
    priorities.push({
      id: "secure-access",
      title: "Secure Access",
      blurb: "Access is the first thing to close: everything else can be undone later, but an attacker who still has a session can redo it.",
      target: { kind: "account", value: accounts[0] ?? null },
      items: [
        ...accounts.map((a) => item(`review-account-${a}`, `Review the ${a} administrator account`, "Confirm with your team whether it was created intentionally")),
        ...accounts.map((a) => item(`disable-account-${a}`, `Disable ${a} if it was not authorised`)),
        item("reset-admin-passwords", "Reset all administrator passwords"),
        item("revoke-sessions", "Revoke active administrator sessions"),
        item("review-app-passwords", "Review application passwords", "Application passwords bypass the normal login screen"),
      ],
    });
  }

  if (t.files.length) {
    priorities.push({
      id: "suspicious-files",
      title: "Investigate Suspicious Files",
      blurb: "Confirm before removing: deleting a legitimate file breaks the site, and a copy of the file is useful evidence.",
      target: { kind: "file", value: t.files[0] },
      items: t.files.flatMap((p) => [
        item(`verify-file-${p}`, `Verify whether /${p} belongs to your website`, "Check whether a known plugin or theme ships it"),
        item(`compare-file-${p}`, `Compare /${p} with a clean backup`),
        item(`firstseen-file-${p}`, `Check when /${p} first appeared`),
        item(`logs-file-${p}`, `Review access logs for /${p}`),
        item(`remove-file-${p}`, `Remove /${p} only once it is confirmed unauthorised`),
      ]),
    });
  }

  if (t.hooks.length) {
    priorities.push({
      id: "persistence",
      title: "Remove Persistence",
      blurb: "A scheduled task can restore everything else you clean up, so it comes before the final integrity pass.",
      target: { kind: "cron", value: t.hooks[0] },
      items: t.hooks.flatMap((h) => [
        item(`verify-cron-${h}`, `Verify whether the cron hook ${h} belongs to a legitimate plugin`),
        item(`remove-cron-${h}`, `Remove ${h} if it is not authorised`),
      ]).concat([item("other-crons", "Check for other recently added cron events")]),
    });
  }

  if (t.config.length) {
    const labels = {
      siteurl_changed: "Revert the site URL to its correct value",
      home_changed: "Revert the home URL to its correct value",
      htaccess_modified: "Review .htaccess for injected rules and restore a known-good copy",
      wp_config_modified: "Review wp-config.php and restore a known-good copy",
    };
    priorities.push({
      id: "configuration",
      title: "Restore Configuration",
      blurb: "Configuration changes are how traffic and mail get redirected away from you.",
      target: { kind: "config", value: t.config[0] },
      items: [
        ...t.config.map((c, i) => item(`config-${c}-${i}`, labels[c] ?? `Review the ${c} change`)),
        item("check-dns", "Check DNS records at the registrar"),
        item("check-smtp", "Review SMTP settings for an unfamiliar host"),
      ],
    });
  }

  priorities.push({
    id: "integrity",
    title: "Restore Website Integrity",
    blurb: "Last, because it only holds once access, files and persistence are dealt with.",
    target: null,
    items: [
      item("verify-core", "Verify WordPress core files"),
      item("verify-plugins", "Verify plugin files"),
      item("verify-themes", "Verify theme files"),
      ...(t.plugins.length
        ? [item("reinstall-plugin", `Reinstall ${t.plugins.join(", ")} from a trusted source`)]
        : []),
      item("rescan", "Re-run the File Integrity Scan"),
    ],
  });

  const stepCount = priorities.reduce((n, p) => n + p.items.length, 0);
  const difficulty = stepCount <= 6 ? "Low" : stepCount <= 12 ? "Medium" : "High";

  return {
    difficulty,
    stepCount,
    priorities,
    guided: buildGuidedSteps(incident, t),
  };
}

/** The step-by-step flow used by the guided fix drawer. */
function buildGuidedSteps(incident, t) {
  const steps = [];

  if (t.accounts.length) {
    const account = t.accounts[0];
    steps.push({
      id: "confirm-account",
      title: `Confirm the suspicious administrator`,
      subject: account,
      question: "Was this account created intentionally?",
      options: ["Yes, authorized", "No, unknown", "Not sure"],
      ifNo: [
        "Disable or remove the account",
        "Reset administrator passwords",
        "Revoke active sessions",
        "Review application passwords",
      ],
      ifUnsure: [
        "Ask whoever manages this website before changing anything",
        "Check the account's recent activity and creation date",
      ],
    });
  }

  for (const p of t.files) {
    steps.push({
      id: `verify-file-${p}`,
      title: "Verify the suspicious file",
      subject: `/${p}`,
      question: "Does this file belong to a known plugin or theme?",
      options: ["Yes, it belongs", "No, unknown", "Not sure"],
      ifNo: ["Back up the file first", "Compare it with a clean copy", "Remove it after confirmation"],
      ifUnsure: [
        "Search the plugin and theme directories for the same filename",
        "Compare its SHA-256 with a clean installation",
        "Leave it in place until you are sure — removing a needed file breaks the site",
      ],
    });
  }

  for (const h of t.hooks) {
    steps.push({
      id: `verify-cron-${h}`,
      title: "Verify the scheduled task",
      subject: h,
      question: "Does this cron hook belong to a legitimate plugin?",
      options: ["Yes, it belongs", "No, unknown", "Not sure"],
      ifNo: ["Remove the cron hook", "Check whether other hooks were added at the same time"],
      ifUnsure: ["Search the installed plugins for the hook name", "Check when it was first registered"],
    });
  }

  steps.push({
    id: "final-verification",
    title: "Re-run verification",
    subject: null,
    question: "Have you completed the steps above?",
    options: ["Yes", "Not yet"],
    ifNo: ["Run the verification check to see what is still outstanding"],
    ifUnsure: ["Work through the remaining priorities, then verify again"],
  });

  return steps;
}

/** Recurrence prevention, ordered by priority. Deterministic, not prescriptive. */
export function buildPrevention(incident, targets = extractTargets(incident)) {
  const t = targets;
  const out = [];

  if (t.accounts.length || incident.entryPoint?.target?.kind === "account") {
    out.push({ level: "HIGH", text: "Enable two-factor authentication for administrators" });
    out.push({ level: "HIGH", text: "Remove unused administrator accounts" });
  }
  if (t.plugins.length || t.themes.length) {
    out.push({ level: "HIGH", text: "Update outdated plugins and themes, and remove the ones you do not use" });
  }
  if (t.files.some((f) => f.includes("uploads/"))) {
    out.push({ level: "MEDIUM", text: "Disable PHP execution inside the uploads directory" });
  }
  if (t.applicationPasswords) {
    out.push({ level: "MEDIUM", text: "Review application passwords and remove any you do not recognise" });
  }
  if (t.config.length) {
    out.push({ level: "MEDIUM", text: "Make wp-config.php and .htaccess read-only for the web server user" });
  }
  out.push({ level: "MEDIUM", text: "Keep a known-good backup and test restoring it" });
  out.push({ level: "LOW", text: "Shorten inactive session lifetime for administrators" });

  return out;
}

/**
 * What ScanSite can actually re-check after a fix.
 *
 * Each check states how it is decided, and reports "Not verified" when no
 * evidence exists rather than guessing. Website availability is the only check
 * that leaves ScanSite (a plain GET of the site URL); the rest are derived from
 * collector events and file records the site already sent.
 */
export function buildVerificationTargets(incident, targets = extractTargets(incident)) {
  const t = targets;
  const checks = [];

  for (const a of t.accounts) {
    checks.push({ id: `account:${a}`, kind: "account", label: "Administrator account", value: a, how: "A user_deleted or role change for this account, recorded after it appeared" });
  }
  for (const f of t.files) {
    checks.push({ id: `file:${f}`, kind: "file", label: "Suspicious file", value: f, how: "A file_deleted event or an integrity record showing it gone" });
  }
  for (const h of t.hooks) {
    checks.push({ id: `cron:${h}`, kind: "cron", label: "Scheduled task", value: h, how: "A cron_removed or cron_modified event for this hook, recorded after it was registered" });
  }
  checks.push({ id: "integrity", kind: "integrity", label: "File integrity", value: "Latest scan", how: "A file integrity scan completed since the incident started, with zero critical files" });
  checks.push({ id: "availability", kind: "availability", label: "Website", value: "HTTP status", how: "ScanSite fetches the site URL and reports the HTTP status" });

  return checks;
}

const ACCOUNT_EVENTS = ["administrator_created", "user_created", "user_role_changed", "login_success"];
const FILE_EVENTS = ["executable_created", "unexpected_executable", "file_created", "suspicious_code_detected", "file_modified"];

const strip = (p) => String(p ?? "").replace(/^\//, "");

/**
 * When each flagged thing first appeared in this incident.
 *
 * Remediation events are usually grouped into the incident they clean up (same
 * account, same file path, same cron hook), so "after the incident ended" is
 * the wrong cut-off — it would hide the very evidence being looked for. A fix
 * counts when it happened after the event that raised the concern.
 */
function referenceTimes(incident) {
  const refs = { account: new Map(), file: new Map(), cron: new Map() };
  for (const e of incident.events ?? []) {
    if (ACCOUNT_EVENTS.includes(e.type)) {
      const name = e.target?.username ?? e.target?.name ?? e.actor?.username;
      if (name && !refs.account.has(name)) refs.account.set(name, e.timestamp);
    }
    if (FILE_EVENTS.includes(e.type)) {
      const p = strip(e.path ?? e.target?.path ?? e.metadata?.file?.relativePath);
      if (p && !refs.file.has(p)) refs.file.set(p, e.timestamp);
    }
    if (e.type === "cron_added" || e.type === "cron_modified") {
      const hook = e.target?.hook ?? e.target?.name;
      if (hook && !refs.cron.has(hook)) refs.cron.set(hook, e.timestamp);
    }
  }
  return refs;
}

/**
 * Evaluate verification checks against real data.
 *
 * @param {object} incident
 * @param {object} data { events, files, siteStatus: {ok, status, error} }
 *                        events — every event stored for this site
 */
export function evaluateVerification(incident, { events = [], eventsAfter = null, files = [], siteStatus = null } = {}) {
  const targets = extractTargets(incident);
  const pool = eventsAfter ?? events;
  const refs = referenceTimes(incident);
  const after = (list, at) => list.filter((e) => at === undefined || e.timestamp > at);
  const results = [];

  for (const a of targets.accounts) {
    const removed = after(pool, refs.account.get(a)).find(
      (e) =>
        (e.type === "user_deleted" || (e.type === "user_role_changed" && !/admin/i.test(e.changes?.to ?? ""))) &&
        (e.target?.username === a || e.target?.name === a || e.actor?.username === a)
    );
    results.push(
      removed
        ? { id: `account:${a}`, kind: "account", label: "Administrator account", value: a, state: "resolved", detail: `${removed.type.replace(/_/g, " ")} recorded after the incident` }
        : { id: `account:${a}`, kind: "account", label: "Administrator account", value: a, state: "not_verified", detail: "No account removal or role change recorded since it appeared" }
    );
  }

  for (const f of targets.files) {
    const deleted = after(pool, refs.file.get(f)).find((e) => e.type === "file_deleted" && strip(e.path ?? e.target?.path) === f);
    const record = files.find((x) => (x.relativePath ?? "").replace(/^\//, "") === f);
    if (deleted || record?.integrityStatus === "deleted") {
      results.push({ id: `file:${f}`, kind: "file", label: "Suspicious file", value: f, state: "resolved", detail: "Deletion recorded by the collector" });
    } else if (record) {
      results.push({ id: `file:${f}`, kind: "file", label: "Suspicious file", value: f, state: "outstanding", detail: `Still present — integrity status "${record.integrityStatus ?? "unknown"}"` });
    } else {
      results.push({ id: `file:${f}`, kind: "file", label: "Suspicious file", value: f, state: "not_verified", detail: "No file record or deletion event for this path" });
    }
  }

  for (const h of targets.hooks) {
    const removed = after(pool, refs.cron.get(h)).find(
      (e) => (e.type === "cron_removed" || e.type === "cron_modified") && (e.target?.hook === h || e.target?.name === h)
    );
    results.push(
      removed
        ? { id: `cron:${h}`, kind: "cron", label: "Scheduled task", value: h, state: "resolved", detail: `${removed.type.replace(/_/g, " ")} recorded after the incident` }
        : { id: `cron:${h}`, kind: "cron", label: "Scheduled task", value: h, state: "not_verified", detail: "No cron removal recorded since it was registered" }
    );
  }

  const scan = after(pool, incident.startedAt)
    .filter((e) => e.type === "file_integrity_scan_completed")
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  if (scan && (scan.metadata?.critical ?? 0) === 0) {
    results.push({ id: "integrity", kind: "integrity", label: "File integrity", value: "Latest scan", state: "resolved", detail: `Scan completed with ${scan.metadata?.filesChecked ?? 0} files checked, 0 critical` });
  } else if (scan) {
    results.push({ id: "integrity", kind: "integrity", label: "File integrity", value: "Latest scan", state: "outstanding", detail: `Latest scan still reports ${scan.metadata?.critical ?? 0} critical file(s)` });
  } else {
    results.push({ id: "integrity", kind: "integrity", label: "File integrity", value: "Latest scan", state: "not_verified", detail: "No integrity scan has completed since the incident" });
  }

  if (siteStatus?.ok && siteStatus.status === 200) {
    results.push({ id: "availability", kind: "availability", label: "Website", value: "HTTP 200", state: "resolved", detail: "Site responded with HTTP 200" });
  } else if (siteStatus?.status) {
    results.push({ id: "availability", kind: "availability", label: "Website", value: `HTTP ${siteStatus.status}`, state: "outstanding", detail: `Site responded with HTTP ${siteStatus.status}` });
  } else {
    results.push({ id: "availability", kind: "availability", label: "Website", value: "Unknown", state: "not_verified", detail: siteStatus?.error ? `Not reachable from ScanSite: ${siteStatus.error}` : "Not checked" });
  }

  const resolved = results.filter((r) => r.state === "resolved").length;
  const outstanding = results.filter((r) => r.state === "outstanding").length;

  return {
    at: Date.now(),
    results,
    resolved,
    outstanding,
    total: results.length,
    // Only "all resolved" earns the resolved recommendation — never a partial.
    canResolve: results.length > 0 && resolved === results.length,
  };
}
