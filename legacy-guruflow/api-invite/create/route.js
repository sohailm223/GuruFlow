import crypto from "crypto";
import { auth } from "@clerk/nextjs/server";
import { fetchHygraph } from "@/lib/hygraph";

export async function POST(req) {
  const { userId } = auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { projectId, role } = await req.json();
  const token = crypto.randomUUID();

  await fetchFromHygraph(`
    mutation {
      createInviteToken(data: {
        token: "${token}"
        role: ${role}
        project: { connect: { id: "${projectId}" } }
        expiresAt: "${new Date(Date.now() + 7 * 86400000).toISOString()}"
      }) {
        id
      }
    }
  `);

  return Response.json({
    url: `${process.env.NEXT_PUBLIC_APP_URL}/onboarding/invite/${token}`,
  });
}
