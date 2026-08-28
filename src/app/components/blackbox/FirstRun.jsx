import Link from "next/link";

/** Empty-state onboarding shown when no websites are connected yet. */
export default function FirstRun() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
      <h2 className="text-xl font-semibold text-slate-900">
        Connect Your First WordPress Website
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
        ScanSite Black Box monitors important WordPress changes and explains what
        happened when something goes wrong.
      </p>
      <Link
        href="/websites/add"
        className="mt-6 inline-block rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-teal-800"
      >
        Connect WordPress Website
      </Link>
    </div>
  );
}
