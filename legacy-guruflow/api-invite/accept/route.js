import { auth } from "@clerk/nextjs/server";
import { fetchHygraph } from "@/lib/hygraph";

export async function POST(req) {
  const { userId } = auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { token } = await req.json();

  const data = await fetchFromHygraph(`
    query {
      inviteToken(where: { token: "${token}" }) {
        id
        role
        project { id }
        usedAt
        expiresAt
      }
    }
  `);

  const invite = data.inviteToken;

  if (!invite || invite.usedAt || new Date(invite.expiresAt) < new Date()) {
    return new Response("Invalid invite", { status: 400 });
  }

  await fetchFromHygraph(`
    mutation {
      updateInviteToken(
        where: { id: "${invite.id}" }
        data: { usedAt: "${new Date().toISOString()}" }
      ) { id }

      addUserToProject(
        projectId: "${invite.project.id}"
        clerkId: "${userId}"
        role: ${invite.role}
      ) { id }
    }
  `);

  return Response.json({ success: true });
}
