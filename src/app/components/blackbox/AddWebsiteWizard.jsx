"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Copy, Download } from "lucide-react";

const STEPS = [
  "Enter Website",
  "Install Collector",
  "Connect Website",
  "Verify Connection",
  "Start Monitoring",
];

const ENVIRONMENTS = [
  ["production", "Production"],
  ["staging", "Staging"],
  ["development", "Development"],
];

export default function AddWebsiteWizard({ defaultEndpoint }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    url: "",
    environment: "production",
  });

  const [site, setSite] = useState(null);
  const [pairing, setPairing] = useState(null);
  const [verified, setVerified] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  /* ------------------------------ step 1 ------------------------------ */

  const createWebsite = async (event) => {
    event.preventDefault();
    setError("");

    const res = await fetch("/api/blackbox/sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error ?? "Could not create the website");
      return;
    }

    setSite(data.site);
    setPairing(data.connection);
    setStep(1);
  };

  /* ------------------------------ step 4 ------------------------------ */

  // Poll until the WordPress plugin has redeemed the pairing code.
  const startPolling = () => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      if (!site?.id) return;
      const res = await fetch(`/api/blackbox/sites/${site.id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.site.connectionStatus === "connected") {
        clearInterval(pollRef.current);
        setSite(data.site);
        setStep(3);
      }
    }, 2500);
  };

  const runVerification = async () => {
    if (!site?.id) return;
    setVerifyBusy(true);
    setError("");

    // ScanSite confirms from its side that a test event actually arrived.
    const res = await fetch(`/api/blackbox/sites/${site.id}/verify`);
    const data = await res.json().catch(() => ({}));
    setVerifyBusy(false);

    if (!res.ok) {
      setError(data?.error ?? "ScanSite could not receive the test event.");
      return;
    }

    setVerified(true);
    setStep(4);
  };

  /* ------------------------------- render ----------------------------- */

  return (
    <div className="space-y-6">
      <Stepper current={step} />

      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
        {step === 0 && (
          <Step1
            form={form}
            setForm={setForm}
            onSubmit={createWebsite}
            error={error}
          />
        )}

        {step === 1 && site && (
          <Step2 site={site} onNext={() => { startPolling(); setStep(2); }} />
        )}

        {step === 2 && site && pairing && (
          <Step3 site={site} pairing={pairing} endpoint={defaultEndpoint} />
        )}

        {step === 3 && site && (
          <Step4
            site={site}
            onVerify={runVerification}
            busy={verifyBusy}
            error={error}
          />
        )}

        {step === 4 && site && (
          <Step5
            site={site}
            verified={verified}
            onOpen={() => router.push(`/websites/${site.id}`)}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------- pieces ------------------------------- */

function Stepper({ current }) {
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-2">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={label}
            className={`flex items-center gap-2 text-sm ${
              active ? "font-semibold text-slate-900" : done ? "text-teal-700" : "text-slate-400"
            }`}
          >
            <span
              className={`grid h-6 w-6 place-items-center rounded-full text-xs ${
                active
                  ? "bg-slate-900 text-white"
                  : done
                    ? "bg-teal-100 text-teal-700"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              {done ? <Check size={13} /> : i + 1}
            </span>
            <span className="hidden sm:inline">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Step1({ form, setForm, onSubmit, error }) {
  return (
    <form onSubmit={onSubmit} className="max-w-lg space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Connect a WordPress Website</h2>
        <p className="mt-1 text-sm text-slate-500">
          Start by entering the website you want ScanSite Black Box to monitor.
        </p>
      </div>

      <Field label="Website Name">
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Copper Sky Hearing"
          required
          maxLength={120}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
        />
      </Field>

      <Field label="Website URL">
        <input
          value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
          placeholder="https://copperskyhearing.com"
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
        />
      </Field>

      <Field label="Environment">
        <div className="flex flex-wrap gap-2">
          {ENVIRONMENTS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setForm({ ...form, environment: value })}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${
                form.environment === value
                  ? "bg-slate-900 text-white ring-slate-900"
                  : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <button
        type="submit"
        className="rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-teal-800"
      >
        Continue
      </button>
    </form>
  );
}

function Step2({ site, onNext }) {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Install ScanSite Collector</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          Install the lightweight ScanSite Collector plugin on{" "}
          <span className="font-medium text-slate-700">{site.host}</span>. The
          collector observes important WordPress changes and securely sends
          those events to your ScanSite dashboard.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 p-5">
        <p className="text-sm font-semibold text-slate-900">Option A — Download plugin</p>
        <p className="mt-1 text-sm text-slate-500">
          Download the plugin ZIP and upload it in WordPress.
        </p>
        <a
          href="/api/blackbox/collector/download"
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          <Download size={16} />
          Download Plugin
        </a>
      </div>

      <div className="rounded-lg border border-slate-200 p-5">
        <p className="text-sm font-semibold text-slate-900">Option B — Manual install</p>
        <ol className="mt-3 space-y-1.5 text-sm text-slate-600">
          <li>1. Download ScanSite Collector</li>
          <li>2. Go to WordPress → Plugins → Add New</li>
          <li>3. Upload Plugin</li>
          <li>4. Activate ScanSite Collector</li>
          <li>5. Open ScanSite → Black Box</li>
        </ol>
      </div>

      <button
        onClick={onNext}
        className="rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-teal-800"
      >
        I&apos;ve Installed the Plugin
      </button>
    </div>
  );
}

function Step3({ site, pairing, endpoint }) {
  const [copied, setCopied] = useState(false);
  const [minutesLeft, setMinutesLeft] = useState(null);

  // Read the clock in an effect, never during render.
  useEffect(() => {
    const tick = () =>
      setMinutesLeft(Math.max(0, Math.round((pairing.expiresAt - Date.now()) / 60000)));
    tick();
    const timer = setInterval(tick, 30000);
    return () => clearInterval(timer);
  }, [pairing.expiresAt]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pairing.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Connect Website</h2>
        <p className="mt-1 text-sm text-slate-500">
          Enter this code inside the ScanSite Collector plugin on your WordPress
          website.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Connection Code
        </p>
        <p className="mt-2 font-mono text-3xl font-semibold tracking-[0.2em] text-slate-900">
          {pairing.code}
        </p>
        <button
          onClick={copy}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 hover:underline"
        >
          <Copy size={14} />
          {copied ? "Copied" : "Copy code"}
        </button>
        <p className="mt-3 text-xs text-slate-400">
          {minutesLeft === null
            ? "Single use"
            : minutesLeft > 0
              ? `Expires in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"} · single use`
              : "Expired — generate a new code from the website page"}
        </p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          ScanSite Endpoint
        </p>
        <p className="mt-1 break-all font-mono text-sm text-slate-700">{endpoint}</p>
      </div>

      <div className="flex items-center gap-3 rounded-lg bg-teal-50 p-4">
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-teal-600" />
        <p className="text-sm text-teal-900">
          Waiting for {site.host} to connect… This updates automatically.
        </p>
      </div>
    </div>
  );
}

function Step4({ site, onVerify, busy, error }) {
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Connection Established</h2>
        <p className="mt-1 text-sm text-slate-500">WordPress connected successfully.</p>
      </div>

      <dl className="grid grid-cols-2 gap-4">
        <Fact label="WordPress" value={site.wordpress?.wordpressVersion ?? "—"} />
        <Fact label="PHP" value={site.wordpress?.phpVersion ?? "—"} />
        <Fact label="Collector" value={site.collectorVersion ?? "—"} />
        <Fact label="Environment" value={site.environment} />
      </dl>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm font-medium text-rose-800">Connection Failed</p>
          <p className="mt-1 text-sm text-rose-700">{error}</p>
        </div>
      )}

      <button
        onClick={onVerify}
        disabled={busy}
        className="rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-teal-800 disabled:opacity-60"
      >
        {busy ? "Testing…" : "Run Connection Test"}
      </button>
    </div>
  );
}

function Step5({ site, verified, onOpen }) {
  const monitored = [
    "Plugin changes",
    "Theme changes",
    "File changes",
    "WordPress users",
    "Authentication",
    "Database settings",
    "Cron jobs",
    "Configuration",
    "Redirects",
  ];

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Your Website is Connected</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          ScanSite Black Box is now monitoring important WordPress activity.
        </p>
      </div>

      {verified && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 p-4">
          <p className="text-sm font-medium text-teal-900">Connection Verified</p>
          <p className="mt-1 text-sm text-teal-800">
            Events are reaching ScanSite successfully.
          </p>
        </div>
      )}

      <ul className="grid gap-2 sm:grid-cols-2">
        {monitored.map((item) => (
          <li key={item} className="flex items-center gap-2 text-sm text-slate-700">
            <Check size={15} className="shrink-0 text-teal-600" />
            {item}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={onOpen}
          className="rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-teal-800"
        >
          Open Website Dashboard
        </button>
        <Link
          href="/websites"
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
        >
          All websites
        </Link>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function Fact({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 font-medium capitalize text-slate-800">{value}</dd>
    </div>
  );
}
