/**
 * Correlation — linking events by more than timing.
 *
 * Timing alone groups a busy site into noise. Here events are also linked by
 * actor, IP and target, which is what turns "an admin was created" and "a PHP
 * file appeared" into one story instead of two coincidences.
 */

/** Identity keys an event carries, strongest first. */
export function correlationKeys(e) {
  const keys = [];
  if (e.actor?.ip) keys.push(`ip:${e.actor.ip}`);
  if (e.actor?.userId) keys.push(`user:${e.actor.userId}`);
  if (e.actor?.username) keys.push(`actor:${e.actor.username}`);
  if (e.actor?.session) keys.push(`session:${e.actor.session}`);
  if (e.target?.plugin) keys.push(`plugin:${e.target.plugin}`);
  if (e.target?.theme) keys.push(`theme:${e.target.theme}`);
  if (e.target?.username) keys.push(`account:${e.target.username}`);
  if (e.target?.hook) keys.push(`hook:${e.target.hook}`);

  // The touched file: two events writing the same path are the same story even
  // when nothing else about them matches.
  const path = e.path ?? e.target?.path ?? e.metadata?.file?.relativePath;
  if (typeof path === "string" && path) keys.push(`path:${path.replace(/^\/+/, "")}`);

  return keys;
}

/**
 * Group events into correlated clusters. Events sharing an actor/IP/target
 * land in the same cluster even when other activity sits between them.
 */
export function clusterEvents(events) {
  const clusters = [];
  const keyToCluster = new Map();

  for (const e of events) {
    const keys = correlationKeys(e);
    const matches = keys.map((k) => keyToCluster.get(k)).filter(Boolean);

    let cluster = matches[0];
    if (!cluster) {
      cluster = { keys: new Set(), events: [] };
      clusters.push(cluster);
    }

    // Merge any clusters this event bridges.
    for (const other of matches.slice(1)) {
      if (other === cluster) continue;
      for (const k of other.keys) cluster.keys.add(k);
      cluster.events.push(...other.events);
      clusters.splice(clusters.indexOf(other), 1);
    }

    for (const k of keys) {
      cluster.keys.add(k);
      keyToCluster.set(k, cluster);
    }
    cluster.events.push(e);
  }

  return clusters.map((c) => ({
    keys: [...c.keys],
    events: c.events.sort((a, b) => a.timestamp - b.timestamp),
  }));
}

/**
 * Actors that appear in this incident, with how many events and which IPs.
 */
export function extractActors(events) {
  const map = new Map();

  for (const e of events) {
    const name = e.actor?.username;
    if (!name) continue;
    const entry = map.get(name) ?? {
      username: name,
      role: e.actor?.role ?? null,
      ips: new Set(),
      eventCount: 0,
      firstSeen: e.timestamp,
      lastSeen: e.timestamp,
    };
    if (e.actor?.ip) entry.ips.add(e.actor.ip);
    entry.eventCount += 1;
    entry.lastSeen = Math.max(entry.lastSeen, e.timestamp);
    entry.firstSeen = Math.min(entry.firstSeen, e.timestamp);
    map.set(name, entry);
  }

  return [...map.values()]
    .map((a) => ({ ...a, ips: [...a.ips] }))
    .sort((a, b) => b.eventCount - a.eventCount);
}

/** Categories touched, most active first. */
export function affectedAreas(events) {
  const counts = new Map();
  for (const e of events) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

/** Distinct IPs seen in the incident. */
export function extractIps(events) {
  return [...new Set(events.map((e) => e.actor?.ip).filter(Boolean))];
}

/**
 * Build the attack / change chain: the ordered story, following the strongest
 * correlation available (actor/IP link, else timing).
 */
export function buildAttackChain(events, scored) {
  const suspicious = scored
    .filter((s) => s.score >= 12)
    .map((s) => s.event)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (suspicious.length < 2) return [];

  const chain = [];
  const used = new Set();
  let current = suspicious[0];
  chain.push(current);
  used.add(current);

  while (chain.length < suspicious.length) {
    const currentKeys = new Set(correlationKeys(current));
    const rest = suspicious.filter((e) => !used.has(e));

    // Prefer a later event that shares an actor/IP/target.
    let next = rest.find((e) => correlationKeys(e).some((k) => currentKeys.has(k)));
    // Otherwise take the next suspicious event in time order.
    if (!next) next = rest[0];
    if (!next) break;

    const linked = correlationKeys(next).some((k) => currentKeys.has(k));
    chain.push({ ...next, __linked: linked });
    used.add(next);
    current = next;
  }

  return chain.slice(0, 8).map((e, i) => ({
    step: i + 1,
    eventId: e.eventId,
    type: e.type,
    timestamp: e.timestamp,
    linked: i === 0 ? null : Boolean(e.__linked),
  }));
}
