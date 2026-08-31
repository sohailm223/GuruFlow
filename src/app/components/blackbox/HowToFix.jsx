"use client";

import { useState } from "react";
import Link from "next/link";
import { Wrench, ChevronRight, CircleAlert } from "lucide-react";

/**
 * How to fix — prioritised, incident-specific, and advisory only.
 *
 * ScanSite never performs any of this. The buttons below open information
 * (filtered events, the file inspection page) or the guided checklist; none of
 * them change anything on the WordPress site.
 *
 * Checkbox state is local to this page: it is a working list for the person
 * doing the fix, not a saved record. The saved record is the verification run.
 */
export default function HowToFix({ incident, siteId }) {
  const plan = incident.remediation;
  const [done, setDone] = useState({});
  const [drawerStep, setDrawerStep] = useState(null);

  if (!plan) return null;

  const toggle = (id) => setDone((d) => ({ ...d, [id]: !d[id] }));
  const completed = Object.values(done).filter(Boolean).length;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">How to Fix</h2>
        <p className="text-sm text-slate-500">
          {completed} / {plan.stepCount} steps ticked
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">
          Estimated difficulty: <span className="font-semibold text-slate-800">{plan.difficulty}</span>
        </span>
        <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">
          Estimated steps: <span className="font-semibold text-slate-800">{plan.stepCount}</span>
        </span>
        <button
          type="button"
          onClick={() => setDrawerStep(0)}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Wrench size={15} /> Start Guided Fix
        </button>
      </div>

      <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <CircleAlert size={14} className="mt-0.5 shrink-0" />
        <span>
          Before you start: create a fresh backup. ScanSite does not change your website — every step below is for you
          to carry out.
        </span>
      </p>

      <ol className="mt-5 space-y-6">
        {plan.priorities.map((p, i) => (
          <li key={p.id}>
            <div className="flex flex-wrap items-baseline gap-3">
              <h3 className="text-base font-semibold text-slate-900">
                Priority {i + 1} — {p.title}
              </h3>
              <ContextualActions priority={p} siteId={siteId} onGuide={() => setDrawerStep(0)} />
            </div>
            <p className="mt-1 text-sm text-slate-500">{p.blurb}</p>

            <ul className="mt-3 space-y-2">
              {p.items.map((it) => (
                <li key={it.id}>
                  <label className="flex cursor-pointer items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(done[it.id])}
                      onChange={() => toggle(it.id)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-slate-900"
                    />
                    <span className={done[it.id] ? "text-slate-400 line-through" : "text-slate-700"}>
                      {it.label}
                      {it.detail ? <span className="block text-xs text-slate-500">{it.detail}</span> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <p className="mt-5 text-xs text-slate-400">
        This checklist is not saved anywhere. Run the verification below to record what has actually been resolved.
      </p>

      {drawerStep !== null && (
        <FixGuideDrawer incident={incident} index={drawerStep} onClose={() => setDrawerStep(null)} />
      )}
    </section>
  );
}

/** Buttons that open information or guidance — never an action on the site. */
function ContextualActions({ priority, siteId, onGuide }) {
  const t = priority.target;
  if (!t?.value) return null;

  const q = encodeURIComponent(t.value);

  if (t.kind === "account") {
    return (
      <span className="flex flex-wrap gap-2">
        <Link
          href={`/websites/${siteId}/events?actor=${q}`}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          View User
        </Link>
        <button
          type="button"
          onClick={onGuide}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Show Fix Steps
        </button>
      </span>
    );
  }

  if (t.kind === "file") {
    return (
      <span className="flex flex-wrap gap-2">
        <Link
          href={`/websites/${siteId}/files?search=${q}`}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Inspect File
        </Link>
        <button
          type="button"
          onClick={onGuide}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          How to Fix
        </button>
      </span>
    );
  }

  if (t.kind === "cron") {
    return (
      <span className="flex flex-wrap gap-2">
        <Link
          href={`/websites/${siteId}/events?q=${q}`}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          View Cron
        </Link>
        <button
          type="button"
          onClick={onGuide}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          How to Verify
        </button>
      </span>
    );
  }

  return null;
}

/** Guided fix drawer: one question at a time, with the advice for each answer. */
function FixGuideDrawer({ incident, index: initial, onClose }) {
  const steps = incident.remediation?.guided ?? [];
  const [index, setIndex] = useState(Math.min(initial, Math.max(0, steps.length - 1)));
  const [answer, setAnswer] = useState(null);

  const step = steps[index];
  if (!step) return null;

  const advice = answer === null ? [] : /^yes/i.test(answer) ? [] : /^no/i.test(answer) ? step.ifNo ?? [] : step.ifUnsure ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-6 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Fix This Incident</p>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">Step {index + 1} of {steps.length} — {step.title}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">
            Close
          </button>
        </div>

        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Estimated difficulty {incident.remediation.difficulty} · {incident.remediation.stepCount} steps · create a
          fresh backup before changing anything.
        </p>

        {step.subject ? <p className="mt-4 break-all font-mono text-sm text-slate-800">{step.subject}</p> : null}
        <p className="mt-3 text-sm font-medium text-slate-800">{step.question}</p>

        <div className="mt-3 space-y-2">
          {(step.options ?? []).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setAnswer(o)}
              className={`block w-full rounded-lg border px-3 py-2 text-left text-sm ${
                answer === o ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
            >
              {o}
            </button>
          ))}
        </div>

        {answer && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recommended</p>
            {advice.length === 0 ? (
              <p className="mt-1 text-sm text-slate-600">
                No change needed for this step — record why it is expected and move on.
              </p>
            ) : (
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
                {advice.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ol>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={() => { setAnswer(null); setIndex((i) => Math.max(0, i - 1)); }}
            disabled={index === 0}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Back
          </button>
          {index < steps.length - 1 ? (
            <button
              type="button"
              onClick={() => { setAnswer(null); setIndex((i) => i + 1); }}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Next <ChevronRight size={15} />
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Finish
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
