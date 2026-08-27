import { NextResponse } from "next/server";
import { hygraph } from "@/lib/hygraph";

export async function GET() {
  try {
    const query = `
      query {
        projects {
          id
          title
          assignClient {
            id
            name
            email
          }
        }
      }
    `;

    const data = await hygraph.request(query);
    return NextResponse.json(data.projects);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch projects" },
      { status: 500 }
    );
  }
}
