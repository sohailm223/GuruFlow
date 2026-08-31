import Link from "next/link";
import { OctagonAlert, Repeat2, ArrowRight } from "lucide-react";

/**
 * Error Evidence on an incident page.
 *
 * Shows the recorded error exactly as the collector reported it — message,
 * component, file, line, occurrence count — plus the likely cause and the
 * specific events that produced it.
 *
 * Language rules, same as everywhere else in ScanSite:
 *   - The error itself is stated plainly, because it was recorded.
 *   - The cause is always hedged ("may have introduced") and always carries a
 *     confidence and its evidence list.
 *   - When no recorded change explains the error, that is what the panel says.
 *     It does not name a cause the events do not support.
 */
export default function ErrorEvidence({ incident }) {
  const ev = incident?.errorEvidence;
  if (!ev || !ev.groups?.length) return null;

  return (
    <div className="space-y-4">
      {ev.groups.map((g) => (
        <ErrorCard key={g.fingerprint} group={g} incidentId={incident.id} />
      ))}
    </div>
  );
}

/**
 * The extra detail rows a family recorded.
 *
 * Rendered only when the collector actually sent the field, so a database
 * error does not show an empty "Endpoint" row and a REST error does not show an
 * empty "Table" row. A missing field is a missing field, not a blank.
 *
 * @param {object} group
 */
function FamilyFields({ group: g }) {
  const rows = [];

  if (g.endpoint) rows.push(["Endpoint", `${g.httpMethod ? `${g.httpMethod} ` : ""}${g.endpoint}`]);
  if (g.status && g.family !== "http") rows.push(["Status", `HTTP ${g.status}`]);
  if (g.ajaxAction) rows.push(["AJAX action", g.ajaxAction]);
  if (g.queryType) rows.push(["Query type", g.queryType]);
  if (g.table) rows.push(["Table", g.table]);
  if (g.transport) rows.push(["Mail transport", g.transport]);
  if (g.cronHook) rows.push(["Cron hook", g.cronHook]);
  if (g.schedule) rows.push(["Schedule", g.schedule]);
  if (g.scriptUrl) rows.push(["Script", `${g.scriptUrl}${g.column ? `:${g.line}:${g.column}` : g.line ? `:${g.line}` : ""}`]);
  if (g.pageUrl) rows.push(["Page", g.pageUrl]);
  if (g.browser) rows.push(["Browser", g.browser]);
  if (g.context) rows.push(["Context", g.context]);
  if (g.responseTimeMs != null) rows.push(["Response time", `${g.responseTimeMs} ms`]);

  if (!rows.length) return null;

  return rows.map(([label, value]) => (
    <Field key={label} label={label}>
      <span className="break-all font-mono text-xs text-slate-800">{value}</span>
    </Field>
  ));
}

/**
 * Card heading per family.
 *
 * "PHP Fatal Error" is the wording the error suite asserts on, so the PHP
 * family keeps it exactly. Every other family gets its own label rather than
 * borrowing PHP's, because a refused REST request is not a fatal.
 *
 * @param {object} g
 * @returns {string}
 */
function headingFor(g) {
  switch (g.family) {
    case "http":
      return "HTTP Error Response";
    case "rest":
      return "REST API Error";
    case "ajax":
      return "AJAX Error";
    case "database":
      return "Database Error";
    case "email":
      return "Email Delivery Error";
    case "cron":
      return "Scheduled Task Error";
    case "javascript":
      return "JavaScript Error";
    case "wp":
      return "WordPress Error";
    default:
      return "PHP Fatal Error";
  }
}

function ErrorCard({ group: g, incidentId }) {
  const corr = g.correlation;

  return (
    <section className="overflow-hidden rounded-xl border border-rose-200 bg-rose-50/50">
      <header className="flex items-start justify-between gap-3 border-b border-rose-200 bg-rose-100/60 px-5 py-3">
        <div className="flex items-center gap-2">
          <OctagonAlert className="h-4 w-4 text-rose-600" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-rose-700">
            {headingFor(g)}
          </h2>
        </div>
        {g.repeating ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            <Repeat2 className="h-3 w-3" /> Repeating
          </span>
        ) : null}
      </header>

      <dl className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-2">
        <Field label="Message">
          <span className="break-words font-mono text-xs text-slate-800">
            {g.message ?? "No message recorded"}
          </span>
        </Field>

        <Field label="Component">
          <span className="text-sm text-slate-800">
            {g.componentName ?? g.componentLabel}
            <span className="ml-1 text-xs text-slate-500">({g.componentLabel})</span>
          </span>
        </Field>

        <Field label="File">
          {g.relativePath ? (
            <span className="break-all font-mono text-xs text-slate-800">{g.relativePath}</span>
          ) : (
            <span className="text-xs text-slate-500">
              Not recorded — this error did not name a file
            </span>
          )}
        </Field>

        <Field label="Line">
          {g.line ? (
            <span className="font-mono text-sm text-slate-800">{g.line}</span>
          ) : (
            <span className="text-xs text-slate-500">Not recorded</span>
          )}
        </Field>

        <Field label="Occurrences">
          <span className="text-sm text-slate-800">{g.occurrences}</span>
          <span className="ml-2 text-xs text-slate-500">
            first {new Date(g.firstSeen).toLocaleString()}, last{" "}
            {new Date(g.lastSeen).toLocaleString()}
          </span>
        </Field>

        {g.requestPath ? (
          <Field label="Request">
            <span className="break-all font-mono text-xs text-slate-800">
              {g.requestMethod ? `${g.requestMethod} ` : ""}
              {g.requestPath}
            </span>
          </Field>
        ) : null}

        <FamilyFields group={g} />
      </dl>

      <div className="border-t border-rose-200 bg-white/60 px-5 py-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Likely cause
        </h3>

        {corr?.likelyCause ? (
          <>
            <p className="mt-1 text-sm text-slate-900">{corr.likelyCause}</p>
            <p className="mt-1 text-xs text-slate-600">
              Confidence {corr.confidence}% ({corr.confidenceLabel})
            </p>
            <ul className="mt-3 space-y-1">
              {corr.evidence.map((e, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                  <span>
                    {e.text}
                    {e.eventId ? (
                      <span className="ml-1 font-mono text-[10px] text-slate-400">
                        {e.eventId}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-600">{corr?.explanation}</p>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t border-rose-200 bg-rose-100/40 px-5 py-3">
        <Link
          href={`/errors`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:text-rose-800"
        >
          View Error Details <ArrowRight className="h-3 w-3" />
        </Link>
        <a
          href="#how-to-fix"
          className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800"
        >
          How to Fix
        </a>
        <span className="ml-auto text-[11px] text-slate-500">
          Incident {incidentId}
        </span>
      </footer>
    </section>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
