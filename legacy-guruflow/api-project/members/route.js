import { auth } from "@clerk/nextjs/server";
import { fetchHygraph } from "@/lib/hygraph";

export async function POST(req) {
  const { userId } = auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { projectId, memberId, role } = await req.json();

  await fetchFromHygraph(`
    mutation {
      createProjectMember(data: {
        role: ${role}
        project: { connect: { id: "${projectId}" } }
        user: { connect: { id: "${memberId}" } }
      }) {
        id
      }
    }
  `);

  return Response.json({ success: true });
}
