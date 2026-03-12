import { updateUserListRole } from "@/lib/user.service";

export async function POST(req) {
  const { clerkId, role } = await req.json();
  await updateUserListRole(clerkId, role);
  return new Response("OK");
}
