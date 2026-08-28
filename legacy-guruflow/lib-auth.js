import { auth } from "@clerk/nextjs/server";
import { getUserListByClerkId } from "./user.service";

export async function getCurrentUser() {
  const { userId } = auth();
  if (!userId) return null;

  return await getUserListByClerkId(userId);
}
