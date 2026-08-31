/**
 * Remediation planning and verification.
 *
 * Builds an incident-specific, prioritised fix plan plus a recurrence-prevention
 * list, and defines the post-fix verification checks.
 *
 * ScanSite NEVER performs these actions. Everything here is advice for a human:
 * no file is deleted, no account disabled, no option reverted, no plugin
 * reinstalled by this code. The contextual buttons in the UI open information
 * or guidance — they do not mutate the WordPress site.
 *
 * Two rules this file is written around:
 *
 *   1. Every recommendation cites the event that caused it. "Review the
 *      support_wp administrator account" alone is not actionable — the plan
 *      says *why* (account created 6 minutes before a suspicious executable)
 *      and names the event id so it can be checked in the event log.
 *   2. Verification separates strong from weak evidence. An explicit removal
 *      event is strong (`verified_resolved`); absence from a later snapshot is
 *      weaker and is reported as `likely_resolved`, never as confirmed.
 */

/* ------------------------------------------------------------------ *
 * Targets and provenance
 * ------------------------------------------------------------------ */

const ACCOUNT_EVENTS = ["administrator_created", "user_created", "user_role_changed", "login_success"];
const FILE_EVENTS = ["executable_created", "unexpected_executable", "file_created", "suspicious_code_detected", "file_modified"];
const CONFIG_EVENTS = ["siteurl_changed", "home_changed", "htaccess_modified", "wp_config_modified"];

const MINUTE = 60_000;
const strip = (p) => String(p ?? "").replace(/^\//, "");
const words = (type) => String(type ?? "").replace(/_/g, " ");
const minutesAfter = (from, to) => Math.max(1, Math.round((to.timestamp - from.timestamp) / MINUTE));

/**
 * Collect the concrete things this incident touched, each with the event that
 * put it on the list.
 *
 * @returns {{accounts: string[], files: string[], hooks: string[], plugins: string[],
 *            themes: string[], config: string[], applicationPasswords: boolean,
 *            evidence: {account: Object, file: Object, cron: Object, config: Object}}}
 */
export function extractTargets(incident) {
  const events = incident.events ?? [];
  const accounts = new Set();
  const files = new Set();
  const hooks = new Set();
  const plugins = new Set();
  const themes = new Set();
  const config = [];

  const evidence = { account: {}, file: {}, cron: {}, config: {} };

  const suspiciousExecutable = events.find(
    (e) => ["executable_created", "unexpected_executable"].includes(e.type) && /\.php$/i.test(strip(e.path ?? e.target?.path ?? ""))
  );

  for (const e of events) {
    if (["administrator_created", "user_created", "user_role_changed"].includes(e.type)) {
      const name = e.target?.username ?? e.target?.name ?? e.actor?.username;
      if (name && !accounts.has(name)) {
        accounts.add(name);
        const followUp = suspiciousExecutable && suspiciousExecutable.timestamp > e.timestamp ? suspiciousExecutable : null;
        evidence.account[name] = {
          eventId: e.eventId ?? null,
          at: e.timestamp,
          reason: followUp
            ? `account activity recorded ${minutesAfter(e, followUp)} minutes before a suspicious executable appeared at ${strip(followUp.path ?? followUp.target?.path)}`
            : `${words(e.type)} recorded in this incident window`,
        };
      }
    }
    if (e.type === "login_success" && e.actor?.username) {
      const name = e.actor.username;
      if (!accounts.has(name)) {
        accounts.add(name);
        evidence.account[name] = { eventId: e.eventId ?? null, at: e.timestamp, reason: "successful login recorded in this incident window" };
      }
    }

    if (FILE_EVENTS.includes(e.type)) {
      const p = strip(e.path ?? e.target?.path ?? e.metadata?.file?.relativePath);
      if (p && /\.php$/i.test(p) && !files.has(p)) {
        files.add(p);
        evidence.file[p] = {
          eventId: e.eventId ?? null,
          at: e.timestamp,
          reason:
            e.actor?.username
              ? `${words(e.type)} attributed to ${e.actor.username}`
              : `${words(e.type)} recorded in this incident window`,
        };
      }
    }

    if (e.type === "cron_added" || e.type === "cron_modified") {
      const hook = e.target?.hook ?? e.target?.name;
      if (hook && !hooks.has(hook)) {
        hooks.add(hook);
        const anchor = suspiciousExecutable && suspiciousExecutable.timestamp <= e.timestamp ? suspiciousExecutable : null;
        evidence.cron[hook] = {
          eventId: e.eventId ?? null,
          at: e.timestamp,
          reason: anchor
            ? `registered ${minutesAfter(anchor, e)} minutes after a suspicious executable appeared`
            : `${words(e.type)} recorded in this incident window`,
        };
      }
    }

    if (e.target?.plugin) plugins.add(e.target.plugin);
    if (e.target?.theme) themes.add(e.target.theme);

    if (CONFIG_EVENTS.includes(e.type) && !config.includes(e.type)) {
      config.push(e.type);
      evidence.config[e.type] = {
        eventId: e.eventId ?? null,
        at: e.timestamp,
        reason: e.changes?.to ? `${words(e.type)} to ${e.changes.to}` : `${words(e.type)} recorded in this incident window`,
      };
    }
  }

  const fileList = [...files].slice(0, 3);

  return {
    accounts: [...accounts],
    files: fileList,
    hooks: [...hooks],
    plugins: [...plugins],
    themes: [...themes],
    config: [...new Set(config)],
    applicationPasswords: events.some((e) => e.type === "application_password_created" || e.type === "application_password_deleted"),
    evidence,
  };
}

/** A checklist line, always carrying the evidence that produced it. */
const item = (id, label, detail = null, evidence = null) => ({
  id,
  label,
  detail,
  evidence: evidence ? { eventId: evidence.eventId ?? null, reason: evidence.reason ?? null } : null,
});

const cite = (targets, kind, key) => targets.evidence?.[kind]?.[key] ?? null;

/* ------------------------------------------------------------------ *
 * Fix plan
 * ------------------------------------------------------------------ */

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
    const first = cite(t, "account", accounts[0]) ?? {
      eventId: entry?.target?.eventId ?? null,
      reason: "entry-point classification points at this account",
    };
    priorities.push({
      id: "secure-access",
      title: "Secure Access",
      blurb: "Access is the first thing to close: everything else can be undone later, but an attacker who still has a session can redo it.",
      target: { kind: "account", value: accounts[0] ?? null },
      items: [
        ...accounts.map((a) =>
          item(`review-account-${a}`, `Review the ${a} administrator account`, "Confirm with your team whether it was created intentionally", cite(t, "account", a) ?? first)
        ),
        ...accounts.map((a) => item(`disable-account-${a}`, `Disable ${a} if it was not authorised`, null, cite(t, "account", a) ?? first)),
        item("reset-admin-passwords", "Reset all administrator passwords", null, first),
        item("revoke-sessions", "Revoke active administrator sessions", null, first),
        item("review-app-passwords", "Review application passwords", "Application passwords bypass the normal login screen", first),
      ],
    });
  }

  if (t.files.length) {
    const first = cite(t, "file", t.files[0]);
    priorities.push({
      id: "suspicious-files",
      title: "Investigate Suspicious Files",
      blurb: "Confirm before removing: deleting a legitimate file breaks the site, and a copy of the file is useful evidence.",
      target: { kind: "file", value: t.files[0] },
      items: t.files.flatMap((p) => [
        item(`verify-file-${p}`, `Verify whether /${p} belongs to your website`, "Check whether a known plugin or theme ships it", cite(t, "file", p) ?? first),
        item(`compare-file-${p}`, `Compare /${p} with a clean backup`, null, cite(t, "file", p) ?? first),
        item(`firstseen-file-${p}`, `Check when /${p} first appeared`, null, cite(t, "file", p) ?? first),
        item(`logs-file-${p}`, `Review access logs for /${p}`, null, cite(t, "file", p) ?? first),
        item(`remove-file-${p}`, `Remove /${p} only once it is confirmed unauthorised`, null, cite(t, "file", p) ?? first),
      ]),
    });
  }

  if (t.hooks.length) {
    const first = cite(t, "cron", t.hooks[0]);
    priorities.push({
      id: "persistence",
      title: "Remove Persistence",
      blurb: "A scheduled task can restore everything else you clean up, so it comes before the final integrity pass.",
      target: { kind: "cron", value: t.hooks[0] },
      items: t.hooks
        .flatMap((h) => [
          item(`verify-cron-${h}`, `Verify whether the cron hook ${h} belongs to a legitimate plugin`, null, cite(t, "cron", h) ?? first),
          item(`remove-cron-${h}`, `Remove ${h} if it is not authorised`, null, cite(t, "cron", h) ?? first),
        ])
        .concat([item("other-crons", "Check for other recently added cron events", null, first)]),
    });
  }

  if (t.config.length) {
    const labels = {
      siteurl_changed: "Revert the site URL to its correct value",
      home_changed: "Revert the home URL to its correct value",
      htaccess_modified: "Review .htaccess for injected rules and restore a known-good copy",
      wp_config_modified: "Review wp-config.php and restore a known-good copy",
    };
    const first = cite(t, "config", t.config[0]);
    priorities.push({
      id: "configuration",
      title: "Restore Configuration",
      blurb: "Configuration changes are how traffic and mail get redirected away from you.",
      target: { kind: "config", value: t.config[0] },
      items: [
        ...t.config.map((c, i) => item(`config-${c}-${i}`, labels[c] ?? `Review the ${c} change`, null, cite(t, "config", c) ?? first)),
        item("check-dns", "Check DNS records at the registrar", "ScanSite does not monitor DNS", first),
        item("check-smtp", "Review SMTP settings for an unfamiliar host", null, first),
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
      ...(t.plugins.length ? [item("reinstall-plugin", `Reinstall ${t.plugins.join(", ")} from a trusted source`)] : []),
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
  const ev = (kind, key) => {
    const e = cite(t, kind, key);
    return e ? { eventId: e.eventId ?? null, reason: e.reason ?? null } : null;
  };

  if (t.accounts.length) {
    const account = t.accounts[0];
    steps.push({
      id: "confirm-account",
      title: `Confirm the suspicious administrator`,
      subject: account,
      evidence: ev("account", account),
      question: "Was this account created intentionally?",
      options: ["Yes, authorized", "No, unknown", "Not sure"],
      ifNo: ["Disable or remove the account", "Reset administrator passwords", "Revoke active sessions", "Review application passwords"],
      ifUnsure: ["Ask whoever manages this website before changing anything", "Check the account's recent activity and creation date"],
    });
  }

  for (const p of t.files) {
    steps.push({
      id: `verify-file-${p}`,
      title: "Verify the suspicious file",
      subject: `/${p}`,
      evidence: ev("file", p),
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
      evidence: ev("cron", h),
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
    evidence: null,
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
  const accountEv = t.evidence?.account?.[t.accounts?.[0]] ?? null;
  const pluginEv = t.evidence?.config?.[t.config?.[0]] ?? null;

  if (t.accounts.length || incident.entryPoint?.target?.kind === "account") {
    out.push({ level: "HIGH", text: "Enable two-factor authentication for administrators", evidence: accountEv });
    out.push({ level: "HIGH", text: "Remove unused administrator accounts", evidence: accountEv });
  }
  if (t.plugins.length || t.themes.length) {
    out.push({ level: "HIGH", text: "Update outdated plugins and themes, and remove the ones you do not use", evidence: pluginEv });
  }
  if (t.files.some((f) => f.includes("uploads/"))) {
    out.push({ level: "MEDIUM", text: "Disable PHP execution inside the uploads directory", evidence: t.evidence?.file?.[t.files[0]] ?? null });
  }
  if (t.applicationPasswords) {
    out.push({ level: "MEDIUM", text: "Review application passwords and remove any you do not recognise", evidence: null });
  }
  if (t.config.length) {
    out.push({ level: "MEDIUM", text: "Make wp-config.php and .htaccess read-only for the web server user", evidence: pluginEv });
  }
  out.push({ level: "MEDIUM", text: "Keep a known-good backup and test restoring it", evidence: null });
  out.push({ level: "LOW", text: "Shorten inactive session lifetime for administrators", evidence: accountEv });

  return out;
}

/* ------------------------------------------------------------------ *
 * Verification
 * ------------------------------------------------------------------ */

/**
 * Verification result states.
 *
 *   verified_resolved  strong evidence the problem is gone (explicit removal
 *                      event, a clean integrity scan, an HTTP 200)
 *   likely_resolved    weaker evidence — absent from a later snapshot, or a
 *                      clean aggregate scan. Reported separately, never as
 *                      confirmed.
 *   still_present      evidence the problem is still there
 *   not_verified       no evidence either way
 *   not_monitored      ScanSite cannot check this at all (excluded from totals)
 */
export const VERIFICATION_STATES = ["verified_resolved", "likely_resolved", "still_present", "not_verified", "not_monitored"];

export const REMEDIATION_STATUSES = ["not_started", "in_progress", "partially_resolved", "verified"];

/**
 * What ScanSite can actually re-check after a fix.
 */
export function buildVerificationTargets(incident, targets = extractTargets(incident)) {
  const t = targets;
  const checks = [];

  for (const a of t.accounts) {
    checks.push({ id: `account:${a}`, kind: "account", label: "Administrator account", value: a, how: "A user_deleted or role change (strong), or absence from a later users snapshot (weaker)" });
  }
  for (const f of t.files) {
    checks.push({ id: `file:${f}`, kind: "file", label: "Suspicious file", value: f, how: "A file_deleted event (strong), or a clean integrity scan that no longer flags it (weaker)" });
  }
  for (const h of t.hooks) {
    checks.push({ id: `cron:${h}`, kind: "cron", label: "Scheduled task", value: h, how: "A cron_removed or cron_modified event for this hook, recorded after it was registered" });
  }
  checks.push({ id: "integrity", kind: "integrity", label: "File integrity", value: "Latest scan", how: "A file integrity scan completed since the incident started, with zero critical files" });
  checks.push({ id: "availability", kind: "availability", label: "Website", value: "HTTP status", how: "ScanSite fetches the registered site origin and reports the HTTP status only" });
  if (t.config.length) {
    checks.push({ id: "dns", kind: "dns", label: "DNS records", value: "Not monitored", how: "The collector does not monitor DNS — check at the registrar" });
  }

  return checks;
}

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

/** The most recent users snapshot at or after a moment, as a username → isAdmin map. */
function snapshotAfter(events, at) {
  const snap = events
    .filter((e) => e.type === "users_snapshot" && Array.isArray(e.metadata?.users) && (at === undefined || e.timestamp > at))
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  if (!snap) return null;
  const map = new Map();
  for (const u of snap.metadata.users) if (u?.username) map.set(u.username, Boolean(u.isAdmin));
  return { at: snap.timestamp, eventId: snap.eventId ?? null, users: map };
}

/**
 * Evaluate verification checks against real data.
 *
 * @param {object} incident
 * @param {object} data
 *   events      every event stored for this site
 *   files       file records for this site
 *   siteStatus  { ok, status, error, blocked } from netguard.probeStatus
 *   now         timestamp for the verification record
 */
export function evaluateVerification(incident, { events = [], files = [], siteStatus = null, now = Date.now() } = {}) {
  const targets = extractTargets(incident);
  const refs = referenceTimes(incident);
  const after = (at) => events.filter((e) => at === undefined || e.timestamp > at);
  const results = [];

  /* --- accounts: removal event is strong, snapshot absence is weak --- */
  for (const a of targets.accounts) {
    const removed = after(refs.account.get(a)).find(
      (e) =>
        (e.type === "user_deleted" || (e.type === "user_role_changed" && !/admin/i.test(e.changes?.to ?? ""))) &&
        (e.target?.username === a || e.target?.name === a || e.actor?.username === a)
    );
    const base = { id: `account:${a}`, kind: "account", label: "Administrator account", value: a };

    if (removed) {
      results.push({ ...base, state: "verified_resolved", strength: "strong", detail: `${words(removed.type)} recorded after the account appeared`, evidence: removed.eventId ?? null });
      continue;
    }
    const snap = snapshotAfter(events, refs.account.get(a));
    if (snap) {
      const present = snap.users.has(a);
      const isAdmin = snap.users.get(a);
      if (!present) {
        results.push({ ...base, state: "likely_resolved", strength: "weak", detail: "Not listed in the latest users snapshot — snapshots are periodic, so this is weaker than a removal event", evidence: snap.eventId });
      } else if (!isAdmin) {
        results.push({ ...base, state: "likely_resolved", strength: "weak", detail: "Latest users snapshot no longer shows administrator role", evidence: snap.eventId });
      } else {
        results.push({ ...base, state: "still_present", strength: "strong", detail: "Latest users snapshot still lists this account as an administrator", evidence: snap.eventId });
      }
      continue;
    }
    results.push({ ...base, state: "not_verified", strength: null, detail: "No removal, role change or users snapshot recorded since it appeared", evidence: null });
  }

  /* --- files: deletion event is strong, a clean scan is weaker --- */
  const scan = after(incident.startedAt)
    .filter((e) => e.type === "file_integrity_scan_completed")
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  for (const f of targets.files) {
    const deleted = after(refs.file.get(f)).find((e) => e.type === "file_deleted" && strip(e.path ?? e.target?.path) === f);
    const record = files.find((x) => strip(x.relativePath) === f);
    const base = { id: `file:${f}`, kind: "file", label: "Suspicious file", value: f };

    if (deleted) {
      results.push({ ...base, state: "verified_resolved", strength: "strong", detail: "file deleted event recorded by the collector", evidence: deleted.eventId ?? null });
    } else if (record?.integrityStatus === "deleted") {
      results.push({ ...base, state: "verified_resolved", strength: "strong", detail: "file record reports the path as deleted", evidence: record.id ?? null });
    } else if (record) {
      results.push({ ...base, state: "still_present", strength: "strong", detail: `Still present — integrity status "${record.integrityStatus ?? "unknown"}"`, evidence: record.id ?? null });
    } else if (scan && (scan.metadata?.critical ?? 0) === 0 && (scan.metadata?.suspicious ?? 0) === 0) {
      results.push({ ...base, state: "likely_resolved", strength: "weak", detail: "No file record for this path and the latest integrity scan is clean — scan results are aggregate, so this is weaker than a deletion event", evidence: scan.eventId ?? null });
    } else {
      results.push({ ...base, state: "not_verified", strength: null, detail: "No file record or deletion event for this path", evidence: null });
    }
  }

  /* --- cron: only an explicit removal counts; nothing is inferred --- */
  for (const h of targets.hooks) {
    const removed = after(refs.cron.get(h)).find(
      (e) => (e.type === "cron_removed" || e.type === "cron_modified") && (e.target?.hook === h || e.target?.name === h)
    );
    const base = { id: `cron:${h}`, kind: "cron", label: "Scheduled task", value: h };
    results.push(
      removed
        ? { ...base, state: "verified_resolved", strength: "strong", detail: `${words(removed.type)} recorded after the hook was registered`, evidence: removed.eventId ?? null }
        : { ...base, state: "not_verified", strength: null, detail: "No cron removal recorded since it was registered — the collector does not snapshot cron, so absence proves nothing here", evidence: null }
    );
  }

  /* --- integrity --- */
  if (scan && (scan.metadata?.critical ?? 0) === 0) {
    results.push({ id: "integrity", kind: "integrity", label: "File integrity", value: "Latest scan", state: "verified_resolved", strength: "strong", detail: `Scan completed with ${scan.metadata?.filesChecked ?? 0} files checked, 0 critical`, evidence: scan.eventId ?? null });
  } else if (scan) {
    results.push({ id: "integrity", kind: "integrity", label: "File integrity", value: "Latest scan", state: "still_present", strength: "strong", detail: `Latest scan still reports ${scan.metadata?.critical ?? 0} critical file(s)`, evidence: scan.eventId ?? null });
  } else {
    results.push({ id: "integrity", kind: "integrity", label: "File integrity", value: "Latest scan", state: "not_verified", strength: null, detail: "No integrity scan has completed since the incident", evidence: null });
  }

  /* --- availability: the only check that leaves ScanSite --- */
  const availability = { id: "availability", kind: "availability", label: "Website", value: "HTTP status" };
  if (siteStatus?.blocked) {
    results.push({ ...availability, value: "Blocked", state: "not_monitored", strength: null, detail: `Not fetched: ${siteStatus.blocked}`, evidence: null });
  } else if (siteStatus?.ok && siteStatus.status === 200) {
    results.push({ ...availability, value: "HTTP 200", state: "verified_resolved", strength: "strong", detail: "Registered site origin responded with HTTP 200", evidence: null });
  } else if (siteStatus?.status) {
    results.push({ ...availability, value: `HTTP ${siteStatus.status}`, state: "still_present", strength: "strong", detail: `Registered site origin responded with HTTP ${siteStatus.status}`, evidence: null });
  } else {
    results.push({ ...availability, value: "Unknown", state: "not_verified", strength: null, detail: siteStatus?.error ? `Not reachable from ScanSite: ${siteStatus.error}` : "Not checked", evidence: null });
  }

  /* --- things ScanSite cannot watch at all --- */
  if (targets.config.length) {
    results.push({
      id: "dns",
      kind: "dns",
      label: "DNS records",
      value: "Not monitored",
      state: "not_monitored",
      strength: null,
      detail: "The collector does not monitor DNS. Check the records at the registrar.",
      evidence: null,
    });
  }

  const count = (state) => results.filter((r) => r.state === state).length;
  const verified = count("verified_resolved");
  const likely = count("likely_resolved");
  const stillPresent = count("still_present");
  const notVerified = count("not_verified");
  const notMonitored = count("not_monitored");

  // Checks ScanSite can actually judge. Unmonitored ones never count either way.
  const total = results.length - notMonitored;
  const resolved = verified + likely;

  return {
    at: now,
    verifiedAt: now,
    results,
    verified,
    likely,
    resolved,
    stillPresent,
    notVerified,
    notMonitored,
    outstanding: stillPresent,
    total,
    // Only "everything judged is resolved" earns the resolved recommendation.
    canResolve: total > 0 && resolved === total && stillPresent === 0,
    remediationStatus: remediationStatusFrom({ resolved, total, stillPresent }),
    stale: false,
    staleReason: null,
  };
}

/**
 * Remediation progress, tracked separately from the incident's own status:
 * an incident can be confirmed while its cleanup is only half done.
 *
 *   not_started         no verification run yet
 *   in_progress         verification run, nothing confirmed resolved yet
 *   partially_resolved  some checks resolved, others outstanding
 *   verified            every check ScanSite can judge is resolved
 */
export function remediationStatusFrom({ resolved, total, stillPresent }) {
  if (!total) return "not_started";
  if (resolved >= total && !stillPresent) return "verified";
  if (resolved > 0) return "partially_resolved";
  return "in_progress";
}

/**
 * Is a recorded verification now out of date?
 *
 * A verification says "this was true when we looked". If a new event afterwards
 * touches the same account, the same file path or the same cron hook — or a
 * fresh scan reports critical files again — the previous result no longer
 * describes the site, and the UI must ask for a re-check instead of showing a
 * stale pass.
 *
 * @param {object} incident  with its stored `verification`
 * @param {Array}  newEvents events stored since the verification ran
 * @returns {{stale: boolean, reason?: string, eventId?: string, at?: number}}
 */
export function verificationStaleness(incident, newEvents = []) {
  const verification = incident.verification;
  if (!verification?.verifiedAt) return { stale: false };
  if (verification.stale) return { stale: true, reason: verification.staleReason ?? null, eventId: verification.staleEventId ?? null };

  const targets = extractTargets(incident);
  const at = verification.verifiedAt;
  const later = newEvents.filter((e) => Number.isFinite(e.timestamp) && e.timestamp > at);
  if (!later.length) return { stale: false };

  const hit = (predicate) => later.find(predicate);

  const accountHit = hit(
    (e) =>
      ACCOUNT_EVENTS.includes(e.type) &&
      targets.accounts.some((a) => e.target?.username === a || e.target?.name === a || e.actor?.username === a)
  );
  if (accountHit) {
    return { stale: true, reason: `New activity on the ${accountHit.target?.username ?? accountHit.actor?.username ?? "flagged"} account after verification`, eventId: accountHit.eventId ?? null, at: accountHit.timestamp };
  }

  const fileHit = hit((e) => FILE_EVENTS.includes(e.type) && targets.files.includes(strip(e.path ?? e.target?.path ?? e.metadata?.file?.relativePath)));
  if (fileHit) {
    return { stale: true, reason: `${strip(fileHit.path ?? fileHit.target?.path)} appeared or changed again after verification`, eventId: fileHit.eventId ?? null, at: fileHit.timestamp };
  }

  const cronHit = hit(
    (e) => (e.type === "cron_added" || e.type === "cron_modified") && targets.hooks.includes(e.target?.hook ?? e.target?.name)
  );
  if (cronHit) {
    return { stale: true, reason: `Cron hook ${cronHit.target?.hook ?? cronHit.target?.name} was registered or changed again after verification`, eventId: cronHit.eventId ?? null, at: cronHit.timestamp };
  }

  const badScan = hit((e) => e.type === "file_integrity_scan_completed" && (e.metadata?.critical ?? 0) > 0);
  if (badScan) {
    return { stale: true, reason: `A new integrity scan reports ${badScan.metadata?.critical} critical file(s)`, eventId: badScan.eventId ?? null, at: badScan.timestamp };
  }

  return { stale: false };
}
