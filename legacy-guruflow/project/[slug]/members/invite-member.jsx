"use client";

import { useState } from "react";

export default function InviteMember({ projectId }) {
  const [role, setRole] = useState("CLIENT");
  const [inviteUrl, setInviteUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generateInvite = async () => {
    try {
      setLoading(true);
      setError("");

      const res = await fetch("/api/invite/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          role,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to generate invite");
      }

      const data = await res.json();
      setInviteUrl(data.url);
    } catch (err) {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: 24 }}>
      <h3>Invite Member</h3>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="CLIENT">Client</option>
          <option value="DEVELOPER">Developer</option>
          <option value="PM">Project Manager</option>
        </select>

        <button onClick={generateInvite} disabled={loading}>
          {loading ? "Generating..." : "Generate Invite"}
        </button>
      </div>

      {inviteUrl && (
        <div style={{ marginTop: 12 }}>
          <p>Invite link:</p>
          <code style={{ wordBreak: "break-all" }}>{inviteUrl}</code>
        </div>
      )}

      {error && (
        <p style={{ color: "red", marginTop: 8 }}>{error}</p>
      )}
    </div>
  );
}
