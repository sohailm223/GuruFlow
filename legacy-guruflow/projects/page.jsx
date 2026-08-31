import Link from "next/link";
import { fetchHygraph } from "@/lib/hygraph";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const data = await fetchHygraph(`
    query {
      projects {
        id
        title
        slug
        startDate
      }
    }
  `);

  return (
    <>

      <ul className="space-y-2">
        {data.projects.map((project) => (
          <li key={project.id}>
            <Link
              href={`/project/${project.slug}`}
              className="text-blue-600 hover:underline"
            >
              {project.title}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
