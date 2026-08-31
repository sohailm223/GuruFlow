"use client";

import { useEffect, useState } from "react";

export default function UsersPage() {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    fetch("/api/users/pending")
      .then(res => res.json())
      .then(data => setUsers(data));
  }, []);

  const approve = async (clerkId, role) => {
    await fetch("/api/users/update-role", {
      method: "POST",
      body: JSON.stringify({ clerkId, role })
    });
    location.reload();
  };

  return (
    <div>
      <h2>Pending Users</h2>
      {users.map(u => (
        <div key={u.clerkId}>
          {u.email}
          <button onClick={() => approve(u.clerkId, "DEVELOPER")}>Dev</button>
          <button onClick={() => approve(u.clerkId, "PM")}>PM</button>
          <button onClick={() => approve(u.clerkId, "CLIENT")}>Client</button>
        </div>
      ))}
    </div>
  );
}
