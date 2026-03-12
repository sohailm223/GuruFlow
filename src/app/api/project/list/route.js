import { auth } from "@clerk/nextjs/server";
import { fetchHygraph } from "@/lib/hygraph";

export async function GET() {
  const { userId } = auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const data = await fetchFromHygraph(`
    query {
      projects {
        id
        title
      }
    }
  `);

  return Response.json({ projects: data.projects });
}
