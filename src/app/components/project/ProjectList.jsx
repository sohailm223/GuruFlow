import ProjectCard from "./ProjectCard";

export default function ProjectList({ projects = [] }) {
  if (!projects.length) {
    return <p className="text-gray-500">No projects found</p>;
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {projects.map((project, i) => (
        <ProjectCard key={i} project={project} />
      ))}
    </div>
  );
}
