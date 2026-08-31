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

const isErrorEvent = (e) => e?.type === "php_error" || e?.type === "http_error";

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
    }))
    .sort((a, b) => b.lastSeen - a.lastSeen);
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

  // 5. Repeats make it a persistent condition rather than a one-off.
  if (group.occurrences > 1) {
    evidence.push({
      eventId: group.eventIds[0] ?? null,
      timestamp: group.firstSeen,
      text: `Recorded ${group.occurrences} times between ${new Date(group.firstSeen).toISOString()} and ${new Date(
        group.lastSeen
      ).toISOString()}`,
    });
  }

  if (!componentChange && !fileChange) {
    return {
      likelyCause: null,
      confidence: 0,
      confidenceLabel: "Uncertain",
      evidence,
      explanation: `No recorded change in the ${componentLabel(
        group.component
      ).toLowerCase()} that owns ${group.relativePath ?? "the failing file"} falls within ${windowMinutes} minutes before the first occurrence. ScanSite will not name a cause the events do not support.`,
    };
  }

  const confidence = Math.min(95, score);
  return {
    likelyCause: buildCauseLabel(group, componentChange, fileChange),
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    evidence,
    explanation: null,
  };
}

function buildCauseLabel(group, componentChange, fileChange) {
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

  if (group.component === "plugin" || group.component === "theme") {
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
