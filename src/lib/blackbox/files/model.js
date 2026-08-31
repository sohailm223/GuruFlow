/**
 * File-integrity read model + ingest hook.
 *
 * The heavy lifting (hashing, scanning, line numbers) happens in the WordPress
 * collector. The dashboard stores the normalised records the collector sends
 * and derives the analytics, levels and incident correlations shown in the UI.
 */

import { upsertFile, addFileEventRef, updateSite, findTrusted, expireTrusted, recordAudit } from "../storage";

/** 0–100 risk → human level, kept separate from incident severity. */
export function levelFor(risk) {
  if (risk >= 80) return { key: "critical", label: "Critical" };
  if (risk >= 60) return { key: "high", label: "High" };
  if (risk >= 40) return { key: "medium", label: "Medium" };
  if (risk >= 20) return { key: "low", label: "Low" };
  return { key: "info", label: "Verified" };
}

export const STATUS_LABEL = {
  verified: "Verified",
  expected_change: "Expected",
  modified: "Modified",
  new: "New",
  deleted: "Deleted",
  unknown: "Unknown",
  suspicious: "Suspicious",
  critical: "Critical",
};

const FILE_EVENT_TYPES = new Set([
  "file_created",
  "file_modified",
  "file_deleted",
  "executable_created",
  "file_integrity_mismatch",
  "unexpected_executable",
  "suspicious_code_detected",
  "core_file_mismatch",
  "plugin_file_mismatch",
  "theme_file_mismatch",
]);

export function isFileEvent(e) {
  return FILE_EVENT_TYPES.has(e.type) || Boolean(e.metadata?.file?.relativePath);
}

/** Persist normalised file records + site inventory from ingested events. */
export async function recordFileEvidence(siteId, events) {
  for (const e of events) {
    const file = e.metadata?.file;
    if (file?.relativePath) {
      const record = { ...file, path: e.path ?? `/${file.relativePath}` };

      // Trusted files: path + SHA-256. Trust expires the moment the hash changes.
      const trusted = await findTrusted(siteId, file.relativePath);
      if (trusted && !trusted.expired) {
        if (trusted.sha256 === file.sha256) {
          record.trusted = true;
          record.integrityStatus = "verified";
          record.riskScore = Math.min(record.riskScore ?? 0, 10);
        } else {
          await expireTrusted(trusted.id);
          record.trusted = false;
          record.trustedExpired = true;
          // A trust entry dying because the hash moved is exactly the kind of
          // change an operator needs to see later.
          await recordAudit({
            action: "trusted_file_expired",
            siteId,
            path: file.relativePath,
            reason: "SHA-256 changed since the file was trusted",
          });
        }
      }

      await upsertFile(siteId, record);
      await addFileEventRef(siteId, file.relativePath, e.eventId);
    }

    if (e.type === "site_inventory" && e.metadata) {
      await updateSite(siteId, { inventory: e.metadata, inventoryAt: e.timestamp });
    }
  }
}

/** Files that need a human look (suspicious / critical / high risk). */
export function attentionFiles(files) {
  return files.filter(
    (f) => f.integrityStatus === "critical" || f.integrityStatus === "suspicious" || (f.riskScore ?? 0) >= 60,
  );
}

export function fileDistribution(files) {
  const d = { verified: 0, expected: 0, modified: 0, suspicious: 0, critical: 0, new: 0, deleted: 0 };
  for (const f of files) {
    if (f.integrityStatus === "critical") d.critical++;
    else if (f.integrityStatus === "suspicious") d.suspicious++;
    else if (f.integrityStatus === "expected_change") d.expected++;
    else if (f.integrityStatus === "modified") d.modified++;
    else if (f.integrityStatus === "new") d.new++;
    else if (f.integrityStatus === "deleted") d.deleted++;
    else d.verified++;
  }
  return d;
}

/**
 * File Integrity Score — how closely the site matches its expected state.
 * Deliberately a separate concept from incident risk.
 */
export function integrityScore(files) {
  if (!files.length) return 100;
  const d = fileDistribution(files);
  const penalty = d.critical * 8 + d.suspicious * 4 + d.modified * 1 + d.new * 0.5;
  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

export function categoryBreakdown(files) {
  const map = new Map();
  for (const f of files) {
    const cat = f.category ?? "unknown";
    const cur = map.get(cat) ?? { checked: 0, verified: 0, changed: 0, suspicious: 0, critical: 0, executable: 0 };
    cur.checked++;
    if (f.integrityStatus === "critical") cur.critical++;
    else if (f.integrityStatus === "suspicious") cur.suspicious++;
    else if (f.integrityStatus === "modified" || f.integrityStatus === "expected_change") cur.changed++;
    else cur.verified++;
    if (f.extension === "php" && (f.category === "uploads" || f.category === "unknown")) cur.executable++;
    map.set(cat, cur);
  }
  return [...map.entries()].map(([category, v]) => ({ category, ...v }));
}

/** Incidents whose window overlaps a file's activity (temporal correlation). */
export function relatedIncidents(file, incidents) {
  const t = file.modifiedAt ?? file.lastSeenAt ?? 0;
  return incidents.filter((i) => {
    const start = i.startedAt ?? 0;
    const end = i.endedAt ?? i.startedAt ?? 0;
    return t >= start - 30 * 60_000 && t <= end + 30 * 60_000;
  });
}
