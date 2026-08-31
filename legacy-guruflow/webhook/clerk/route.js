
import { NextResponse } from "next/server";
import { createUserList } from "@/lib/user.service";

export async function POST(req) {
  const payload = await req.json();

  // Listen only for new user created events
  if (payload.type !== "user.created") {
    return NextResponse.json({ ok: true });
  }

  try {
    const user = payload.data;

    // Create user in HyGraph UserList model
    await createUserList({
      clerkId: user.id,
      name: user.first_name + " " + (user.last_name || ""),
      email: user.email_addresses[0].email_address,
      role: "GUEST", // Default role for new users
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json(
      { error: "Failed to create user" },
      { status: 500 }
    );
  }
}
