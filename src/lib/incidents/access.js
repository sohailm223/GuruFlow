/**
 * Access rule for the Black Box section.
 *
 * The rest of GuruFlow sits behind Clerk. The Black Box pages follow the same
 * rule, with one opt-in escape hatch so the feature can be previewed before a
 * Clerk key is configured:
 *
 *   BLACKBOX_PUBLIC_VIEW=true   → allow unauthenticated, read-only viewing
 *
 * Leave it unset in production.
 */

import { auth } from "@clerk/nextjs/server";

export function blackboxPublicView() {
  return process.env.BLACKBOX_PUBLIC_VIEW === "true";
}

/** Returns null when access is allowed, otherwise an error payload. */
export async function assertBlackboxAccess() {
  if (blackboxPublicView()) return null;

  try {
    const { userId } = await auth();
    if (userId) return null;
  } catch {
    // Clerk not configured / no key — fall through to the deny path.
  }

  return {
    status: 401,
    body: {
      error: "Authentication required",
      hint: "Sign in, or set BLACKBOX_PUBLIC_VIEW=true to preview this section.",
    },
  };
}
