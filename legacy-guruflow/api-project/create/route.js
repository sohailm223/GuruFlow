import { auth } from "@clerk/nextjs/server";
import { fetchHygraph } from "@/lib/hygraph";

const COMPANY_ID = "REBRAND_GURUS_COMPANY_ID";

export async function POST(req) {
  const { userId } = auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { title } = await req.json();

  await fetchFromHygraph(`
    mutation {
      createProject(data: {
        title: "${title}"
        company: { connect: { id: "${COMPANY_ID}" } }
      }) {
        id
      }
    }
  `);

  return Response.json({ success: true });
}
