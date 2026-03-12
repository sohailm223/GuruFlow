import { auth, currentUser } from "@clerk/nextjs/server";
import { createUserList, getUserListByClerkId } from "@/lib/user.service";

export async function POST() {
  const { userId } = auth();
  const user = await currentUser();

  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    // Check if user already exists
    const existingUser = await getUserListByClerkId(userId);

    if (!existingUser) {
      // Create new user if doesn't exist
      await createUserList({
        clerkId: userId,
        email: user.emailAddresses[0].emailAddress,
        name: user.fullName,
        role: "GUEST",
      });
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error("Sync user error:", error);
    return Response.json({ error: "Failed to sync user" }, { status: 500 });
  }
}
