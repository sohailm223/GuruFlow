import { getPendingUserLists } from "@/lib/user.service";

export async function GET() {
  const users = await getPendingUserLists();
  return Response.json(users);
}
