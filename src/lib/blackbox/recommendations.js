/**
 * Recommendations — deterministic, derived from the findings.
 *
 * Advice only. ScanSite never deletes files, removes administrators, edits the
 * database, rolls back plugins or restores backups on its own.
 */

const BY_FINDING = {
  "priv-esc-then-backdoor": {
    immediate: [
      "Disable the suspicious administrator account",
      "Quarantine the suspicious PHP file",
      "Disable the suspicious cron job",
      "Force logout of all administrator sessions",
    ],
    investigate: [
      "Review wp_options modifications from this window",
      "Compare plugin files against the official release",
      "Review server access logs for the actor IP",
    ],
    recovery: [
      "Rotate all administrator passwords",
      "Verify WordPress core checksums",
      "Run a full malware scan before reopening the site",
    ],
  },

  "webshell-upload": {
    immediate: ["Quarantine the suspicious PHP file", "Block write access to the uploads directory"],
    investigate: ["Identify which account or plugin wrote the file", "Review recent uploads for other executables"],
    recovery: ["Rotate administrator passwords", "Run a full malware scan"],
  },

  "priv-esc": {
    immediate: ["Disable the unexpected administrator account", "Force logout of all administrator sessions"],
    investigate: ["Confirm with your team whether the account was intentional", "Review recent logins for that account"],
    recovery: ["Rotate administrator passwords"],
  },

  "update-then-breakage": {
    immediate: ["Roll back the component that was just updated", "Restore the site from the pre-update backup if rollback fails"],
    investigate: ["Check the plugin or theme changelog for known breakage", "Review the PHP error log for the failing call"],
    recovery: ["Re-apply the update on a staging copy first"],
  },

  "install-then-breakage": {
    immediate: ["Deactivate the newly installed component"],
    investigate: ["Check whether the component conflicts with an existing plugin"],
    recovery: ["Reinstall from a trusted source if the component is required"],
  },

  "traffic-hijack": {
    immediate: [
      "Revert the redirect, .htaccess or URL change",
      "Disable the account that made the change",
    ],
    investigate: ["Check DNS records at the registrar", "Review SMTP settings for an unfamiliar host"],
    recovery: ["Rotate administrator passwords", "Notify affected users if mail was redirected"],
  },

  persistence: {
    immediate: ["Disable the suspicious cron job"],
    investigate: ["List all scheduled jobs and compare with a clean install"],
    recovery: ["Re-scan after cleanup to confirm nothing was re-registered"],
  },

  "brute-force": {
    immediate: ["Rate-limit or block the attacking IPs", "Enable two-factor authentication for administrators"],
    investigate: ["Check whether any attempt succeeded", "Review application passwords for unknown entries"],
    recovery: ["Rotate administrator passwords if any login succeeded"],
  },

  "config-tamper": {
    immediate: ["Revert the configuration change"],
    investigate: ["Identify which account or process modified the file"],
    recovery: ["Enable file-change monitoring for that path"],
  },

  "routine-maintenance": {
    immediate: [],
    investigate: [],
    recovery: ["No action required — routine maintenance"],
  },
};

export function recommendationsFor(finding, severity) {
  const base = BY_FINDING[finding?.id] ?? {
    immediate: ["Review the changes in this window"],
    investigate: ["Confirm with your team whether the changes were expected"],
    recovery: [],
  };

  const out = {
    immediate: [...base.immediate],
    investigate: [...base.investigate],
    recovery: [...base.recovery],
  };

  if (severity === "critical" && !out.immediate.includes("Take the site offline while investigating")) {
    out.immediate.unshift("Take the site offline while investigating");
  }

  return out;
}

/** Flattened, numbered list for the UI. */
export function numberedRecommendations(recs) {
  const groups = [
    ["Immediate", recs.immediate],
    ["Investigate", recs.investigate],
    ["Recovery", recs.recovery],
  ];

  let n = 0;
  return groups
    .filter(([, items]) => items.length)
    .map(([label, items]) => ({
      label,
      items: items.map((text) => ({ n: ++n, text })),
    }));
}
