import InviteMember from "./invite-member";
import { fetchHygraph } from "@/lib/hygraph";

export default async function MembersPage({ params }) {
  const { projectId } = params;

  const data = await fetchFromHygraph(`
    query {
      project(where: { id: "${projectId}" }) {
        members {
          id
          name
          role
        }
      }
    }
  `);

  return (
    <div>
      <h2>Project Members</h2>

      <ul>
        {data.project.members.map((m) => (
          <li key={m.id}>
            {m.name} – {m.role}
          </li>
        ))}
      </ul>

      <InviteMember projectId={projectId} />
    </div>
  );
}
