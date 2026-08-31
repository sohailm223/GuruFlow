import { GraphQLClient } from "graphql-request";

const HYGRAPH_ENDPOINT = process.env.HYGRAPH_ENDPOINT;
const HYGRAPH_TOKEN = process.env.HYGRAPH_TOKEN;

/**
 * graphql-request client (used by routes that need typed gql requests).
 * Exported so both `hygraph.request(...)` and `fetchHygraph(...)` styles work.
 */
export const hygraph = new GraphQLClient(HYGRAPH_ENDPOINT, {
  headers: {
    Authorization: `Bearer ${HYGRAPH_TOKEN}`,
  },
});

export async function fetchHygraph(query, variables = {}) {
  const res = await fetch(HYGRAPH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${HYGRAPH_TOKEN}`,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
    cache: "no-store",
  });

  const json = await res.json();

  if (!res.ok || json.errors) {
    console.error("Hygraph error:", json.errors);
    throw new Error("Hygraph request failed");
  }

  return json.data;
}
