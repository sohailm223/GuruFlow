import { NextResponse } from "next/server";
import { GraphQLClient, gql } from "graphql-request";

const hygraph = new GraphQLClient(process.env.HYGRAPH_ENDPOINT, {
  headers: {
    Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
  },
});

export async function POST(req) {
  try {
    const { clerkId, name, email, imageUrl } = await req.json();

    const mutation = gql`
      mutation UpsertUser(
        $clerkId: String!
        $name: String!
        $email: String!
        $imageUrl: String
      ) {
        upsertUser(
          where: { clerkId: $clerkId }
          upsert: {
            create: {
              clerkId: $clerkId
              name: $name
              email: $email
              imageUrl: $imageUrl
            }
            update: {
              name: $name
              imageUrl: $imageUrl
            }
          }
        ) {
          id
        }
      }
    `;

    await hygraph.request(mutation, {
      clerkId,
      name,
      email,
      imageUrl,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Hygraph error:", err);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
