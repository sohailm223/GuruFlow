import { headers } from "next/headers";
import AddWebsiteWizard from "@/app/components/blackbox/AddWebsiteWizard";
import { scansiteBaseUrl } from "@/lib/blackbox/dashboard";

export const dynamic = "force-dynamic";

export default async function AddWebsitePage() {
  const store = await headers();
  const host = store.get("host");
  const proto = store.get("x-forwarded-proto") ?? "http";
  const derived = host ? `${proto}://${host}` : "";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Add Website</h1>
        <p className="mt-1 text-sm text-slate-500">
          Connect a WordPress website in five steps.
        </p>
      </header>

      <AddWebsiteWizard defaultEndpoint={scansiteBaseUrl({ url: derived })} />
    </div>
  );
}
