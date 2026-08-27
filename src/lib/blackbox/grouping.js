/**
 * Incident grouping — unchanged in spirit from the original Black Box.
 *
 * Events for one site are split into incidents by silence: a new incident
 * starts after `gapMinutes` of quiet, or once a window exceeds
 * `maxWindowHours`. Grouping stays time-based so it is predictable; the
 * detectors then explain each window.
 */

export const GROUPING_DEFAULTS = {
  gapMinutes: 10,
  maxWindowHours: 6,
};

/**
 * @param {Array} events  normalised events for a single site
 * @returns {Array<Array>} groups of events, oldest first
 */
export function groupIntoIncidents(events, opts = {}) {
  const { gapMinutes, maxWindowHours } = { ...GROUPING_DEFAULTS, ...opts };
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  const groups = [];
  let current = null;

  for (const e of sorted) {
    const last = current ? current[current.length - 1] : null;
    const gap = last ? e.timestamp - last.timestamp : Infinity;
    const span = current ? e.timestamp - current[0].timestamp : 0;

    const startsNew =
      !current || gap > gapMinutes * 60_000 || span > maxWindowHours * 3_600_000;

    if (startsNew) {
      current = [e];
      groups.push(current);
    } else {
      current.push(e);
    }
  }

  return groups;
}

/**
 * Decide which stored incident a new event belongs to, so a slow trickle of
 * events extends an existing incident instead of creating a new one each time.
 */
export function findOpenIncident(existingIncidents, event, opts = {}) {
  const { gapMinutes } = { ...GROUPING_DEFAULTS, ...opts };

  return (
    existingIncidents.find(
      (incident) =>
        incident.siteId === event.siteId &&
        incident.status !== "resolved" &&
        incident.endedAt &&
        event.timestamp - incident.endedAt <= gapMinutes * 60_000 &&
        event.timestamp >= incident.startedAt - gapMinutes * 60_000
    ) ?? null
  );
}
