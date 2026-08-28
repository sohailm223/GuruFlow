"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewProjectPage() {
  const [title, setTitle] = useState("");
  const router = useRouter();

  const createProject = async () => {
    await fetch("/api/project/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });

    router.push("/projects");
  };

  return (
    <div>
      <h1>Create Project</h1>
      <input
        placeholder="Project title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <button onClick={createProject}>Create</button>
    </div>
  );
}
