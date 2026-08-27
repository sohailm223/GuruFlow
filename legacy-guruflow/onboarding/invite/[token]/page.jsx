"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function InviteAcceptPage({ params }) {
  const { token } = params;
  const router = useRouter();
  const [status, setStatus] = useState("processing");

  useEffect(() => {
    const accept = async () => {
      const res = await fetch("/api/invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (res.ok) {
        router.push("/dashboard");
      } else {
        setStatus("invalid");
      }
    };

    accept();
  }, []);

  if (status === "invalid") return <p>Invalid or expired invite.</p>;

  return <p>Accepting invite...</p>;
}
