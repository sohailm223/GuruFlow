/**
 * Confidence — how sure the engine is about the likely cause.
 *
 * Deterministic on purpose (no AI). Confidence rises with corroborating
 * evidence and falls when a competing explanation is nearly as strong.
 */

export function confidenceFor({ findings, evidenceCount, eventCount }) {
  const top = findings[0];
  if (!top) return 0;

  // Start from how strongly the leading pattern matched.
  let confidence = Math.min(60, 25 + top.weight / 2);

  // More corroborating events in the same window -> more sure.
  confidence += Math.min(18, evidenceCount * 4);

  // A very thin window is easier to misread.
  if (eventCount <= 2) confidence -= 15;
  else if (eventCount >= 5) confidence += 6;

  // A close runner-up means the story is ambiguous.
  const runnerUp = findings[1];
  if (runnerUp && top.weight > 0) {
    const margin = (top.weight - runnerUp.weight) / top.weight;
    confidence -= Math.round((1 - margin) * 20);
  }

  return clamp(Math.round(confidence));
}

export function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

export function confidenceLabel(confidence) {
  if (confidence >= 90) return "Highly likely";
  if (confidence >= 70) return "Likely";
  if (confidence >= 50) return "Possible";
  return "Uncertain";
}

/**
 * Map a raw internal score onto the 0–100 scale users see.
 *
 * Piecewise linear through anchors rather than a smooth curve: a log curve
 * scores a single trivial event in the 60s, which makes every incident look
 * serious. Anchors are set so the reference scenarios land in the band the
 * product expects:
 *
 *   routine updates        raw  12  ->   8  INFO
 *   38 failed logins       raw  24  ->  22  LOW
 *   update then breakage   raw  31  ->  43  MEDIUM
 *   redirect hijacking     raw  82  ->  78  HIGH
 *   full compromise        raw 123  ->  94  CRITICAL
 */
const RISK_ANCHORS = [
  [0, 0],
  [12, 8],
  [24, 22],
  [32, 45],
  [50, 60],
  [85, 80],
  [130, 96],
  [220, 100],
];

export function riskScoreFromRaw(raw) {
  if (!(raw > 0)) return 0;

  for (let i = 1; i < RISK_ANCHORS.length; i++) {
    const [x1, y1] = RISK_ANCHORS[i - 1];
    const [x2, y2] = RISK_ANCHORS[i];
    if (raw <= x2) {
      const t = (raw - x1) / (x2 - x1);
      return clamp(Math.round(y1 + t * (y2 - y1)));
    }
  }

  return 100;
}

export const SEVERITY_BANDS = [
  { min: 80, severity: "critical", label: "Critical" },
  { min: 60, severity: "high", label: "High" },
  { min: 40, severity: "medium", label: "Medium" },
  { min: 20, severity: "low", label: "Low" },
  { min: 0, severity: "info", label: "Info" },
];

export function severityFromScore(score) {
  const band = SEVERITY_BANDS.find((b) => score >= b.min);
  return { severity: band.severity, label: band.label };
}
