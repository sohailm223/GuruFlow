import { GraphQLClient, gql } from "graphql-request";

import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

// --------------------
// Hygraph Client
// --------------------
const hygraph = new GraphQLClient(process.env.HYGRAPH_ENDPOINT, {
  headers: {
    Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
  },
});

// --------------------
// GraphQL Query
// --------------------
const GET_PROJECTS = gql`
  query MyQuery {
    projects {
      slug
      title
      projectStatus
      startDate
      endDate
      totalBudget
      developmentUrl
      liveUrl
      projectMember {
        role
        user {
          name
          role
        }
      }
    }
  }
`;

// --------------------
// Helpers
// --------------------
function getRemainingDays(endDate) {
  if (!endDate) return null;
  const end = new Date(endDate);
  const today = new Date();
  const diff = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
  return diff >= 0 ? diff : 0;
}

// --------------------
// SERVER COMPONENT
// --------------------
export default async function DashboardPage() {
  const data = await hygraph.request(GET_PROJECTS);
  const projectsRaw = data?.projects || [];

  const projects = projectsRaw.map((p, index) => ({
    id: index,
    slug: p.slug,
    name: p.title,
    status: p.projectStatus || "Unknown",
    startDate: p.startDate || null,
    endDate: p.endDate || null,
    remainingDays: getRemainingDays(p.endDate),
    pm: p.projectMember?.find((m) => m.role === "PM")?.user || null,
    developer: p.projectMember?.find((m) => m.role === "DEVELOPER")?.user || null,
    client: p.projectMember?.find((m) => m.role === "CLIENT")?.user || null,
    team: p.projectMember || [],
    budget: p.totalBudget || 0,
  }));

  const stats = {
    totalProjects: projects.length,
    activeProjects: projects.filter((p) => p.status === "Active").length,
    overdueProjects: projects.filter((p) => p.remainingDays === 0).length,
    revenue: projects.reduce((sum, p) => sum + p.budget, 0),
  };

  const teamMap = new Map();
  projectsRaw.forEach((p) => {
    p.projectMember?.forEach((m) => {
      if (m.user?.name) {
        teamMap.set(m.user.name, {
          name: m.user.name,
          role: m.role || m.user.role,
        });
      }
    });
  });

  const team = Array.from(teamMap.values());

  return (
    <DashboardClient
      projects={projects}
      stats={stats}
      team={team}
    />
  );
}
