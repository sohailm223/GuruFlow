import { headers } from "next/headers";
import AddWebsiteWizard from "@/app/components/blackbox/AddWebsiteWizard";
import { scansiteBaseUrl } from "@/lib/blackbox/dashboard";

export const dynamic = "force-dynamic";

export default async function AddWebsitePage() {
  const store = await headers();

  // Prefer the public address reported by a proxy/tunnel so the wizard shows
  // an endpoint the WordPress site can actually reach.
  const endpoint = scansiteBaseUrl({
    host: store.get("host"),
    fwdHost: store.get("x-forwarded-host"),
    proto: store.get("x-forwarded-proto"),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Add Website</h1>
        <p className="mt-1 text-sm text-slate-500">
          Connect a WordPress website in five steps.
        </p>
      </header>

      <AddWebsiteWizard defaultEndpoint={endpoint} />
    </div>
  );
}
