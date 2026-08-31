/**
 * Error evidence.
 *
 * Turns recorded php_error / http_error events into something a developer can
 * act on: which file and line, which component owns it, how often it happened,
 * and what changed immediately beforehand.
 *
 * The governing rule is the same one the rest of ScanSite follows: nothing here
 * asserts a root cause. A correlation is reported as a likely cause with a
 * confidence and the specific evidence that produced it. If no preceding change
 * touches the component that owns the failing file, the answer is "no recorded
 * change explains this yet" — not a guess.
 *
 * ScanSite has no vulnerability database, does not read file contents and does
 * not execute anything, so the strongest claim available is always about
 * recorded activity: what changed, when, and in which component.
 */

const MINUTE = 60_000;

/** How far back to look for a change that could explain an error. */
export const CORRELATION_WINDOW_MINUTES = 30;

/** Component ids the collector can report, plus the fallbacks. */
export const ERROR_COMPONENTS = [
  { id: "core", label: "WordPress Core" },
  { id: "plugin", label: "Plugin" },
  { id: "theme", label: "Theme" },
  { id: "mu_plugin", label: "MU Plugin" },
  { id: "uploads", label: "Uploads" },
  { id: "config", label: "Configuration" },
  { id: "content", label: "wp-content" },
  { id: "external", label: "Outside WordPress" },
  { id: "unknown", label: "Unknown" },
];

const COMPONENT_LABELS = Object.fromEntries(ERROR_COMPONENTS.map((c) => [c.id, c.label]));

/** @returns {string} Human label for a component id, without inventing one. */
export function componentLabel(id) {
  return COMPONENT_LABELS[id] ?? "Unknown";
}

/**
 * The error families, and the event type each one is recorded as.
 *
 * One entry per family rather than one per type, because the UI filters and
 * the fix steps are written against families. A family that the collector does
 * not emit yet still belongs here, so an event of that type arriving from
 * anywhere is grouped and rendered correctly instead of being dropped.
 */
export const ERROR_KINDS = [
  { id: "php", label: "PHP", types: ["php_error"] },
  { id: "http", label: "HTTP", types: ["http_error"] },
  { id: "rest", label: "REST", types: ["rest_error"] },
  { id: "ajax", label: "AJAX", types: ["ajax_error"] },
  { id: "database", label: "Database", types: ["db_error"] },
  { id: "email", label: "Email", types: ["mail_error"] },
  { id: "cron", label: "Cron", types: ["cron_error"] },
  { id: "javascript", label: "JavaScript", types: ["js_error"] },
  { id: "wp", label: "WP_Error", types: ["wp_error"] },
];

const KIND_BY_TYPE = Object.fromEntries(ERROR_KINDS.flatMap((k) => k.types.map((t) => [t, k.id])));
const KIND_LABELS = Object.fromEntries(ERROR_KINDS.map((k) => [k.id, k.label]));

/** @returns {string|null} The family an event type belongs to, or null if it is not an error. */
export function errorKind(type) {
  return KIND_BY_TYPE[type] ?? null;
}

/** @returns {string} Human label for a family id. */
export function errorKindLabel(id) {
  return KIND_LABELS[id] ?? "Error";
}

/** Every event type the error engine understands. */
export const ERROR_EVENT_TYPES = Object.keys(KIND_BY_TYPE);

const isErrorEvent = (e) => KIND_BY_TYPE[e?.type] !== undefined;

/**
 * Normalise an error message the same way the collector does.
 *
 * Kept here as well as in PHP so grouping still works for events ingested
 * before the collector did it, and so the two can be cross-checked in tests.
 */
export function normaliseMessage(message) {
  let m = String(message ?? "").toLowerCase();
  m = m.replace(/^uncaught\s+[a-z0-9_\\]*(error|exception|throwable)\s*:\s*/, "");
  m = m.replace(/0x[0-9a-f]+/g, "#addr");
  m = m.replace(/\d+/g, "#");
  m = m.replace(/(['"])[^'"]*\1/g, '"?"');
  m = m.replace(/\s+/g, " ");
  return m.trim();
}

/**
 * Stable identity for a recurring error: type + normalised message + file + line.
 *
 * Uses the collector's own fingerprint when present so server-side grouping
 * agrees with the counts the collector already accumulated.
 */
export function errorFingerprint(e) {
  const m = e?.metadata ?? {};
  if (m.fingerprint) return m.fingerprint;
  const base = `${m.severity ?? e?.type ?? ""}|${normaliseMessage(m.message)}|${m.relativePath ?? ""}|${m.line ?? ""}`;
  return base;
}

/**
 * Collapse repeated errors into groups.
 *
 * A crash loop that fired 37 times becomes one group with occurrences 37 and a
 * first/last window, instead of 37 near-identical rows.
 *
 * @param {Array} events Raw events (already filtered or not — non-errors are ignored).
 * @returns {Array} Groups sorted by most recent activity first.
 */
export function groupErrors(events) {
  const groups = new Map();

  for (const e of events ?? []) {
    if (!isErrorEvent(e)) continue;

    const m = e.metadata ?? {};
    const fp = errorFingerprint(e);
    const at = e.timestamp ?? 0;
    // The collector reports how many occurrences this event stands for.
    const n = Math.max(1, Number(m.occurrences ?? 1));

    let g = groups.get(fp);
    if (!g) {
      g = {
        fingerprint: fp,
        type: e.type,
        // One family per group. Derived from the event type rather than
        // metadata.kind so a collector that omits kind still filters correctly.
        family: errorKind(e.type),
        familyLabel: errorKindLabel(errorKind(e.type)),
        kind: m.kind ?? null,
        severity: m.severity ?? null,
        errorClass: m.errorClass ?? null,
        code: m.code ?? null,
        message: m.message ?? null,
        file: m.file ?? null,
        relativePath: m.relativePath ?? null,
        line: m.line ?? null,
        component: m.component ?? "unknown",
        componentSlug: m.componentSlug ?? null,
        componentName: m.componentName ?? null,
        requestPath: m.requestPath ?? null,
        requestMethod: m.requestMethod ?? null,
        phpVersion: m.phpVersion ?? null,
        // Family-specific detail. Every one of these is optional; a group
        // simply carries the fields its family recorded.
        status: m.status ?? null,
        responseTimeMs: m.responseTimeMs ?? null,
        endpoint: m.endpoint ?? null,
        httpMethod: m.httpMethod ?? null,
        ajaxAction: m.ajaxAction ?? null,
        queryType: m.queryType ?? null,
        table: m.table ?? null,
        transport: m.transport ?? null,
        cronHook: m.cronHook ?? null,
        schedule: m.schedule ?? null,
        scriptUrl: m.scriptUrl ?? null,
        pageUrl: m.pageUrl ?? null,
        column: m.column ?? null,
        browser: m.browser ?? null,
        context: m.context ?? null,
        siteId: e.siteId ?? null,
        occurrences: 0,
        firstSeen: at,
        lastSeen: at,
        eventIds: [],
      };
      groups.set(fp, g);
    }

    g.occurrences += n;
    g.firstSeen = Math.min(g.firstSeen, Number(m.firstSeen ?? 0) * 1000 || at, at);
    g.lastSeen = Math.max(g.lastSeen, at);
    g.eventIds.push(e.eventId);
    // Keep the most detailed copy of the descriptive fields.
    g.message = g.message ?? m.message ?? null;
    g.relativePath = g.relativePath ?? m.relativePath ?? null;
    g.line = g.line ?? m.line ?? null;
    g.component = g.component !== "unknown" ? g.component : (m.component ?? "unknown");
    g.componentName = g.componentName ?? m.componentName ?? null;
    g.componentSlug = g.componentSlug ?? m.componentSlug ?? null;
  }

  return [...groups.values()]
    .map((g) => ({
      ...g,
      repeating: g.occurrences > 1,
      componentLabel: componentLabel(g.component),
      // The two normalised answers every card needs, computed once here so the
      // UI never re-derives them differently from the engine.
      whatFailed: describeFailure(g),
      where: describeLocation(g),
    }))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

/**
 * WHAT FAILED — one line, whatever the family.
 *
 * @param {object} g
 * @returns {string}
 */
export function describeFailure(g) {
  if (!g) return "Error";

  switch (g.family) {
    case "rest":
      return `REST API ${g.status ?? "error"}${g.httpMethod ? ` on ${g.httpMethod} ${g.endpoint ?? ""}` : ""}`.trim();
    case "ajax":
      return `AJAX action ${g.ajaxAction ?? "unknown"} returned ${g.status ? `HTTP ${g.status}` : "an error"}`;
    case "database":
      return `Database error${g.queryType ? ` on ${g.queryType}` : ""}${g.table ? ` ${g.table}` : ""}`;
    case "email":
      return `Email delivery failed${g.transport ? ` via ${g.transport}` : ""}`;
    case "cron":
      return `Scheduled task ${g.cronHook ?? "unknown"} did not complete`;
    case "javascript":
      return "JavaScript error in the browser";
    case "wp":
      return `WordPress error${g.code ? ` ${g.code}` : ""}${g.context ? ` in ${g.context}` : ""}`;
    case "http":
      return `HTTP ${g.status ?? "error"} response`;
    default:
      return g.severity ?? "PHP error";
  }
}

/**
 * WHERE — the most specific location recorded for this family.
 *
 * Returns null when nothing was recorded, so the UI can say "not recorded"
 * rather than inventing a location.
 *
 * @param {object} g
 * @returns {string|null}
 */
export function describeLocation(g) {
  if (!g) return null;

  if (g.family === "rest" && g.endpoint) return `${g.httpMethod ?? ""} ${g.endpoint}`.trim();
  if (g.family === "ajax" && g.ajaxAction) return `/wp-admin/admin-ajax.php?action=${g.ajaxAction}`;
  if (g.family === "cron" && g.cronHook) return `cron hook ${g.cronHook}`;
  if (g.family === "database" && g.table) return `table ${g.table}`;
  if (g.family === "javascript" && g.scriptUrl) {
    return `${g.scriptUrl}${g.line ? `:${g.line}${g.column ? `:${g.column}` : ""}` : ""}`;
  }
  if (g.relativePath) return `${g.relativePath}${g.line ? `:${g.line}` : ""}`;
  if (g.endpoint) return g.endpoint;
  if (g.requestPath) return g.requestPath;
  return null;
}

/* --------------------------------------------------------------- correlate */

/** Change events that can plausibly precede an error, by the component they touch. */
const CHANGE_EVENTS = [
  "plugin_updated",
  "plugin_installed",
  "plugin_activated",
  "plugin_deactivated",
  "plugin_deleted",
  "theme_updated",
  "theme_installed",
  "theme_activated",
  "theme_deleted",
  "wordpress_updated",
  "core_file_modified",
  "core_file_mismatch",
  "plugin_file_mismatch",
  "theme_file_mismatch",
  "file_modified",
  "file_created",
  "files_changed",
  "wp_config_modified",
  "htaccess_modified",
  "active_plugins_changed",
  "option_changed",
  // Configuration changes: any of these can break a request without touching
  // a single file.
  "siteurl_changed",
  "home_changed",
  "smtp_setting_changed",
  "table_changed",
  // Cron changes, which matter most to scheduled-task failures.
  "cron_added",
  "cron_removed",
  "cron_modified",
];

/**
 * Administrative activity that can precede an error.
 *
 * Weaker evidence than a component change: an admin did something, in the same
 * window. It is reported as context, never as a cause on its own, and it never
 * names a motive — only that the activity was recorded.
 */
const ADMIN_ACTIVITY = [
  "administrator_created",
  "user_role_changed",
  "password_reset",
  "application_password_created",
  "plugin_activated",
  "plugin_deactivated",
  "theme_activated",
  "active_plugins_changed",
];

/** Which component a change event is about. */
function changeComponent(e) {
  const t = e.type;
  if (t.startsWith("plugin_") || t === "plugin_file_mismatch") return "plugin";
  if (t.startsWith("theme_") || t === "theme_file_mismatch") return "theme";
  if (t === "wordpress_updated" || t.startsWith("core_")) return "core";
  if (t === "wp_config_modified" || t === "htaccess_modified") return "config";
  return null;
}

/** The plugin/theme slug a change event names, if any. */
function changeSlug(e) {
  return e.target?.plugin ?? e.target?.theme ?? e.target?.slug ?? e.target?.name ?? null;
}

/**
 * Does this change event touch the same component instance as the error?
 *
 * Deliberately narrow: a plugin update only counts as evidence for an error in
 * that plugin. "Some plugin was updated" is not evidence about a different one.
 */
function touchesComponent(e, group) {
  const cc = changeComponent(e);
  if (!cc || cc !== group.component) return false;

  const slug = changeSlug(e);
  if (!group.componentSlug) return true; // component known but instance unknown
  return slug === group.componentSlug;
}

/** Does this change event name the failing file itself? */
function touchesFile(e, group) {
  const p = e.path ?? e.target?.path ?? e.metadata?.file?.relativePath ?? null;
  if (!p || !group.relativePath) return false;
  return p === group.relativePath || p.endsWith(`/${group.relativePath}`) || group.relativePath.endsWith(`/${p}`);
}

/**
 * Work out what most likely caused an error, from recorded events only.
 *
 * Returns { likelyCause, confidence, evidence[] } where every evidence item
 * names the event that supports it. When nothing recorded explains the error,
 * likelyCause is null and the evidence array says so — the UI must not present
 * a cause that these events do not support.
 *
 * @param {object} group A grouped error from groupErrors().
 * @param {Array}  events All events for the site, used as the candidate pool.
 * @param {object} [opts]
 * @param {number} [opts.windowMinutes]
 */
export function correlateError(group, events, opts = {}) {
  const windowMinutes = opts.windowMinutes ?? CORRELATION_WINDOW_MINUTES;
  const windowMs = windowMinutes * MINUTE;

  const pool = (events ?? [])
    .filter((e) => CHANGE_EVENTS.includes(e.type))
    .filter((e) => e.timestamp < group.firstSeen)
    .filter((e) => group.firstSeen - e.timestamp <= windowMs)
    .sort((a, b) => b.timestamp - a.timestamp);

  const evidence = [];
  let score = 0;

  // 1. A change to the very component instance that owns the failing file.
  //
  // `pool` is newest-first, so a plain find() would return whichever change
  // happened last. An explicit lifecycle event (updated / installed /
  // activated) is the more informative citation than a generic file mismatch,
  // and it is what the cause sentence is actually about, so prefer it and fall
  // back to any component change only when there is none.
  const LIFECYCLE = ["plugin_updated", "plugin_installed", "plugin_activated", "theme_updated", "theme_installed", "theme_activated", "wordpress_updated"];
  const componentMatches = pool.filter((e) => touchesComponent(e, group));
  const componentChange =
    componentMatches.find((e) => LIFECYCLE.includes(e.type)) ?? componentMatches[0] ?? null;
  if (componentChange) {
    score += 45;
    evidence.push({
      eventId: componentChange.eventId,
      timestamp: componentChange.timestamp,
      text: `The ${componentLabel(group.component).toLowerCase()} that owns the failing file was changed ${describeGap(
        group.firstSeen - componentChange.timestamp
      )} before the first error`,
    });
  }

  // 2. The failing file itself was modified.
  const fileChange = pool.find((e) => touchesFile(e, group));
  if (fileChange) {
    score += 25;
    evidence.push({
      eventId: fileChange.eventId,
      timestamp: fileChange.timestamp,
      text: `The failing file was itself changed: ${fileChange.path ?? fileChange.target?.path ?? "recorded file change"}`,
    });
  }

  // 3. A WordPress core update when the error is in core.
  if (group.component === "core") {
    const coreUpdate = pool.find((e) => e.type === "wordpress_updated");
    if (coreUpdate) {
      score += 20;
      evidence.push({
        eventId: coreUpdate.eventId,
        timestamp: coreUpdate.timestamp,
        text: "WordPress core was updated shortly before the error began",
      });
    }
  }

  // 4. An HTTP 5xx right after the error — the error had a visible effect.
  const httpFollow = (events ?? [])
    .filter((e) => e.type === "http_error")
    .filter((e) => e.timestamp >= group.firstSeen && e.timestamp - group.firstSeen <= 5 * MINUTE)
    .sort((a, b) => a.timestamp - b.timestamp)[0];
  if (httpFollow) {
    score += 10;
    evidence.push({
      eventId: httpFollow.eventId,
      timestamp: httpFollow.timestamp,
      text: `An HTTP 5xx response followed within ${describeGap(httpFollow.timestamp - group.firstSeen)}`,
    });
  }

  // 5. A configuration change. These break requests without touching a file,
  //    so they are real evidence even when no component changed.
  const CONFIG_EVENTS = ["wp_config_modified", "htaccess_modified", "siteurl_changed", "home_changed", "smtp_setting_changed", "table_changed", "option_changed"];
  const configChange = pool.find((e) => CONFIG_EVENTS.includes(e.type));
  if (configChange) {
    score += 20;
    evidence.push({
      eventId: configChange.eventId,
      timestamp: configChange.timestamp,
      text: `A configuration change (${configChange.type.replace(/_/g, " ")}) was recorded ${describeGap(
        group.firstSeen - configChange.timestamp
      )} before the first error`,
    });
  }

  // 6. A cron change. Weighted heavily for a scheduled-task failure, where it
  //    is close to the whole story, and lightly otherwise.
  const CRON_EVENTS = ["cron_added", "cron_removed", "cron_modified"];
  const cronChange = pool.find((e) => CRON_EVENTS.includes(e.type));
  if (cronChange) {
    score += group.family === "cron" ? 30 : 12;
    evidence.push({
      eventId: cronChange.eventId,
      timestamp: cronChange.timestamp,
      text: `A scheduled-task change (${cronChange.type.replace(/_/g, " ")}) was recorded ${describeGap(
        group.firstSeen - cronChange.timestamp
      )} before the first error`,
    });
  }

  // 7. Administrative activity in the window.
  //
  // Context, never a cause on its own: it is added to the score only when a
  // component or file change already exists, and the sentence it produces
  // names the consequence of the change, not a motive.
  const adminActivity = (events ?? [])
    .filter((e) => ADMIN_ACTIVITY.includes(e.type))
    .filter((e) => e.timestamp < group.firstSeen)
    .filter((e) => group.firstSeen - e.timestamp <= windowMs)
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  if (adminActivity && (componentChange || fileChange)) {
    score += 8;
    evidence.push({
      eventId: adminActivity.eventId,
      timestamp: adminActivity.timestamp,
      text: `Administrative activity (${adminActivity.type.replace(/_/g, " ")}) was recorded in the same window`,
    });
  }

  // 8. Repeats make it a persistent condition rather than a one-off.
  if (group.occurrences > 1) {
    evidence.push({
      eventId: group.eventIds[0] ?? null,
      timestamp: group.firstSeen,
      text: `Recorded ${group.occurrences} times between ${new Date(group.firstSeen).toISOString()} and ${new Date(
        group.lastSeen
      ).toISOString()}`,
    });
  }

  // The change the cause sentence is actually about, whichever scored.
  const causeEvent = componentChange ?? fileChange ?? (group.family === "cron" ? cronChange : null) ?? configChange ?? cronChange ?? null;

  // "Strong" means a change to the component or file that is failing, or a
  // cron change for a cron failure. Anything else is a related change in the
  // window and is labelled as such rather than promoted to a cause.
  const strong = Boolean(componentChange || fileChange || (cronChange && group.family === "cron"));

  if (!causeEvent) {
    return {
      likelyCause: null,
      causeStrength: "none",
      confidence: 0,
      confidenceLabel: "Uncertain",
      evidence,
      firstSeenAfter: null,
      explanation: `No recorded change to the ${componentLabel(
        group.component
      ).toLowerCase()} that owns ${group.where ?? group.relativePath ?? "the failing component"} falls within ${windowMinutes} minutes before the first occurrence. ScanSite will not name a cause the events do not support.`,
    };
  }

  const confidence = Math.min(95, score);
  return {
    likelyCause: strong
      ? buildCauseLabel(group, componentChange, fileChange, cronChange)
      : "Related change detected",
    causeStrength: strong ? "strong" : "weak",
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    evidence,
    // How long after the cited change the error first appeared. This is the
    // "first seen 4 minutes after plugin update" figure on the card.
    firstSeenAfter: {
      gap: group.firstSeen - causeEvent.timestamp,
      change: causeEvent.type,
      eventId: causeEvent.eventId,
    },
    explanation: null,
  };
}

function buildCauseLabel(group, componentChange, fileChange, cronChange = null) {
  const name = group.componentName ?? group.componentSlug ?? componentLabel(group.component);

  if (componentChange) {
    const verb =
      componentChange.type === "plugin_updated" || componentChange.type === "theme_updated"
        ? "update"
        : componentChange.type.includes("install")
          ? "installation"
          : componentChange.type.includes("activ")
            ? "activation"
            : "change";
    return `${name} ${verb} may have introduced this error`;
  }

  if (fileChange) {
    return `A change to ${group.relativePath ?? "the failing file"} may have introduced this error`;
  }

  if (cronChange) {
    return `A scheduled-task change may have introduced this error`;
  }

  return `A change in ${name} may have introduced this error`;
}

/** "4 minutes", "38 seconds" — coarse and honest, never more precise than the data. */
function describeGap(ms) {
  const mins = Math.round(ms / MINUTE);
  if (mins >= 1) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const secs = Math.max(1, Math.round(ms / 1000));
  return `${secs} second${secs === 1 ? "" : "s"}`;
}

/** Mirrors the confidence bands used for entry points, so wording stays consistent. */
function confidenceLabel(c) {
  if (c >= 75) return "Likely";
  if (c >= 55) return "Possible";
  if (c >= 35) return "Speculative";
  return "Uncertain";
}

/* ------------------------------------------------------------ error detail */

/**
 * Everything the Error Evidence panel needs for one incident.
 *
 * @param {Array} events Events belonging to the incident's site/window.
 * @returns {{groups:Array, total:number, repeating:number, components:Array}|null}
 */
export function buildErrorEvidence(events) {
  const groups = groupErrors(events);
  if (!groups.length) return null;

  const correlated = groups.map((g) => ({ ...g, correlation: correlateError(g, events) }));

  const components = [...new Set(correlated.map((g) => g.componentLabel))];

  return {
    groups: correlated,
    // Most actionable first, not merely most recent. A fatal with an exact file
    // and line is what a developer should start from; an HTTP 500 with no file
    // attached is not, even if it was recorded a minute later. Ties go to the
    // error seen most often, then the most recent.
    primary: [...correlated].sort((a, b) => {
      const actionable = (g) => (g.relativePath ? 1 : 0) + (g.line ? 1 : 0);
      return actionable(b) - actionable(a) || b.occurrences - a.occurrences || b.lastSeen - a.lastSeen;
    })[0] ?? null,
    total: correlated.reduce((sum, g) => sum + g.occurrences, 0),
    repeating: correlated.filter((g) => g.repeating).length,
    components,
  };
}

/**
 * Guided fix steps derived from the error evidence.
 *
 * Ordered from "look here first" outward, and every step cites the evidence
 * that produced it. Steps that no evidence supports are omitted rather than
 * padded out with generic advice.
 *
 * @param {object} group A correlated group from buildErrorEvidence().
 * @returns {Array<{id:string,title:string,why:string,evidence:{eventId:string|null}}>}
 */
export function buildErrorFixSteps(group) {
  if (!group) return [];

  const corr = group.correlation ?? correlateError(group, []);
  const causeEvent = corr.evidence?.find((e) => e.eventId)?.eventId ?? null;
  const steps = [];

  if (group.relativePath) {
    steps.push({
      id: "inspect-line",
      title: group.line ? `Inspect ${group.relativePath} line ${group.line}` : `Inspect ${group.relativePath}`,
      why: group.message
        ? `The recorded error is "${truncate(group.message, 120)}" at this location`
        : "The recorded error points at this file",
      evidence: { eventId: group.eventIds?.[0] ?? null },
    });
  }

  const componentChange = corr.evidence?.find((e) => /changed .* before the first error/.test(e.text));
  if (componentChange) {
    steps.push({
      id: "review-change",
      title: `Review the recent ${group.componentLabel.toLowerCase()} change`,
      why: `${group.componentName ?? group.componentLabel} was changed ${describeGap(
        group.firstSeen - componentChange.timestamp
      )} before the error first appeared`,
      evidence: { eventId: componentChange.eventId },
    });
    steps.push({
      id: "compare-version",
      title: "Compare the current version with the previous one",
      why: "If the change was an update, the previous release is the known-good reference",
      evidence: { eventId: componentChange.eventId },
    });
  }

  // Family-specific guidance comes next, so "check first" is the most specific
  // thing the evidence supports rather than generic advice.
  steps.push(...familyFixSteps(group));

  // Only for PHP errors: the undefined-method/function reasoning below is what
  // makes a version mismatch the likely explanation, and it does not transfer
  // to a refused REST request or a failed query.
  if ((group.component === "plugin" || group.component === "theme") && (!group.family || group.family === "php")) {
    steps.push({
      id: "check-compatibility",
      title: `Check PHP ${group.phpVersion ?? ""} and WordPress compatibility for ${group.componentName ?? "this component"}`.replace(
        /\s+/g,
        " "
      ),
      why: "Undefined method and undefined function errors usually mean a version mismatch rather than a broken file",
      evidence: { eventId: group.eventIds?.[0] ?? null },
    });
  }

  steps.push({
    id: "test-staging",
    title: "Reproduce on staging before changing production",
    why: "The failing request path is recorded, so the same route can be exercised safely",
    evidence: { eventId: group.eventIds?.[0] ?? null },
  });

  steps.push({
    id: "reverify",
    title: "Re-run verification",
    why: "Confirms the error stopped being recorded and the site responds normally again",
    evidence: causeEvent ? { eventId: causeEvent } : null,
  });

  return steps;
}

function truncate(s, n) {
  const t = String(s ?? "");
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/**
 * Family-specific steps, inserted before the generic tail.
 *
 * Each one is conditional on evidence actually being present: an email step
 * about the transport only appears when a transport was recorded, a database
 * step about the table only when a table was recorded. No padding.
 *
 * @param {object} group
 * @returns {Array}
 */
function familyFixSteps(group) {
  const ev = { eventId: group.eventIds?.[0] ?? null };

  switch (group.family) {
    case "rest":
      return [
        {
          id: "check-rest-route",
          title: `Check the ${group.httpMethod ?? ""} ${group.endpoint ?? "REST"} route`.trim(),
          why:
            Number(group.status) === 403 || Number(group.status) === 401
              ? "A 401/403 means the request was refused, which is usually a permission callback or an expired credential rather than broken code"
              : "This route returned an error status, so the handler itself is where to look",
          evidence: ev,
        },
        {
          id: "check-rest-code",
          title: `Look up the error code ${group.code ?? "recorded"}`,
          why: "WordPress error codes name the subsystem that refused the request, which narrows the search before reading any code",
          evidence: ev,
        },
      ];

    case "ajax":
      return [
        {
          id: "check-ajax-action",
          title: `Find the handler for the "${group.ajaxAction ?? "unknown"}" action`,
          why: "The action name maps to a wp_ajax_ hook, which identifies the code that answered the request",
          evidence: ev,
        },
        {
          id: "check-ajax-nonce",
          title: "Check the nonce and capability the action requires",
          why: "Most admin-ajax failures are a failed nonce or capability check rather than an exception",
          evidence: ev,
        },
      ];

    case "database":
      return [
        {
          id: "check-db-table",
          title: `Inspect the ${group.table ?? "recorded"} table`,
          why: `${group.queryType ?? "The"} statement failed, so the table structure or its contents are the first thing to verify`,
          evidence: ev,
        },
        {
          id: "check-db-repair",
          title: "Run a table repair and check the error log",
          why: "A corrupt or missing table produces this error repeatedly until it is repaired",
          evidence: ev,
        },
      ];

    case "email":
      return [
        {
          id: "check-mail-transport",
          title: `Check the ${group.transport ?? "mail"} transport`,
          why: "The recorded transport is what actually failed, so its credentials and reachability come first",
          evidence: ev,
        },
        {
          id: "check-mail-provider",
          title: "Confirm the mail provider accepted the connection",
          why: "Most wp_mail failures are a refused connection or a rejected login, not a message problem",
          evidence: ev,
        },
      ];

    case "cron":
      return [
        {
          id: "check-cron-hook",
          title: `Run the ${group.cronHook ?? "scheduled"} hook manually`,
          why: "Running it directly shows the failure immediately instead of waiting for the next schedule",
          evidence: ev,
        },
        {
          id: "check-cron-schedule",
          title: `Check the ${group.schedule ?? "recorded"} schedule is still registered`,
          why: "A hook that is no longer scheduled, or was rescheduled, stops completing",
          evidence: ev,
        },
      ];

    case "javascript":
      return [
        {
          id: "check-js-script",
          title: `Open ${group.scriptUrl ?? "the reported script"}${group.line ? ` at line ${group.line}` : ""}`,
          why: "The browser reported the script and line, which is enough to find the failing statement",
          evidence: ev,
        },
        {
          id: "check-js-cache",
          title: "Check for a stale cached asset after the last deploy",
          why: "A browser running an old bundle against new markup is the most common source of sudden client-side errors",
          evidence: ev,
        },
      ];

    case "http":
      return [
        {
          id: "check-http-route",
          title: `Request ${group.requestPath ?? "the recorded path"} directly`,
          why: `The server returned HTTP ${group.status ?? "an error"} on this path, so it can be reproduced on demand`,
          evidence: ev,
        },
      ];

    case "wp":
      return [
        {
          id: "check-wp-error",
          title: `Trace the ${group.code ?? "recorded"} error code`,
          why: `${group.context ? `It was raised in ${group.context}, which` : "It"} names the subsystem that produced the WP_Error`,
          evidence: ev,
        },
      ];

    default:
      return [];
  }
}

/**
 * The normalised answer set every error can give.
 *
 * This is the shape the UI renders, so a card never has to know which family
 * it is showing: the same eight questions get the same eight fields.
 *
 * @param {object} group A correlated group from buildErrorEvidence().
 * @returns {object}
 */
export function buildErrorAnswers(group) {
  if (!group) return null;

  const corr = group.correlation ?? correlateError(group, []);
  const steps = buildErrorFixSteps(group);

  return {
    whatFailed: group.whatFailed ?? describeFailure(group),
    where: group.where ?? describeLocation(group),
    when: { firstSeen: group.firstSeen, lastSeen: group.lastSeen },
    howOften: group.occurrences,
    whichComponent: group.componentName ?? group.componentLabel,
    whatChanged: corr.likelyCause,
    changeStrength: corr.causeStrength ?? (corr.likelyCause ? "weak" : "none"),
    evidence: corr.evidence ?? [],
    checkFirst: steps[0]?.title ?? null,
  };
}
