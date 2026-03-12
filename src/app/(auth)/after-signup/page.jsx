"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AfterSignup() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isLoaded || !user) return;

    async function syncUser() {
      try {
        const res = await fetch("/api/auth/create-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clerkId: user.id,
            name: user.fullName || user.firstName,
            email: user.primaryEmailAddress.emailAddress,
            imageUrl: user.imageUrl,
          }),
        });

        if (!res.ok) throw new Error("Hygraph sync failed");

        router.push("/dashboard");
      } catch (err) {
        console.error("Signup sync error:", err);
        setError(err.message);
      }
    }

    syncUser();
  }, [isLoaded, user]);

  if (error) {
    return (
      <div className="p-8 text-red-600">
        Signup issue: {error}
        <br />
        <button
          onClick={() => router.push("/dashboard")}
          className="mt-4 underline text-blue-600"
        >
          Continue anyway →
        </button>
      </div>
    );
  }

  return <p className="p-8">Setting up your account...</p>;
}
