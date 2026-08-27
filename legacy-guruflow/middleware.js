import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware({
  publicRoutes: [
    "/",
    "/sign-in(.*)",
    "/sign-up(.*)",
    "/after-signup",
    "/waiting-approval",
    "/about",
    "/onboarding/invite(.*)",
    "/api/webhook/clerk",       // keep this public for Clerk webhooks
    "/api/blackbox/(.*)",       // collector webhook; HMAC-signed when BLACKBOX_INGEST_SECRET is set
  ],
});

export const config = {
  matcher: [
    "/((?!_next|favicon.ico|.*\\..*).*)",
  ],
};
