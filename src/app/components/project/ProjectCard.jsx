import { getRemainingDays } from "@/lib/date";

export default function ProjectCard({ project }) {
  if (!project) return null;

  const remainingDays = getRemainingDays(project.endDate);

  return (
    <div className="border rounded p-4 space-y-3 bg-white">
      {/* Title */}
      <h2 className="text-lg font-semibold">
        {project.title}
      </h2>

      {/* Status */}
      {project.projectStatus && (
        <p className="text-sm text-gray-600">
          Status: <span className="font-medium">{project.projectStatus}</span>
        </p>
      )}

      {/* Dates */}
      {(project.startDate || project.endDate) && (
        <p className="text-sm text-gray-500">
          {project.startDate && `Start: ${project.startDate}`}{" "}
          {project.endDate && ` | End: ${project.endDate}`}
        </p>
      )}

      {/* Remaining days */}
      {remainingDays !== null && (
        <p className="text-sm font-medium">
          ⏳ {remainingDays} days remaining
        </p>
      )}

      {/* Budget */}
      {project.totalBudget && (
        <p className="text-sm">
          💰 Budget: ₹{project.totalBudget}
        </p>
      )}

      {/* URLs */}
      <div className="flex gap-3 text-sm">
        {project.developmentUrl && (
          <a
            href={project.developmentUrl}
            target="_blank"
            className="text-blue-600 underline"
          >
            Dev URL
          </a>
        )}

        {project.liveUrl && (
          <a
            href={project.liveUrl}
            target="_blank"
            className="text-green-600 underline"
          >
            Live URL
          </a>
        )}
      </div>

      {/* Members */}
      {project.projectMember?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mt-3 mb-2">
            Team
          </h3>

          <div className="space-y-2">
            {project.projectMember.map((m, i) => (
              <div
                key={i}
                className="flex justify-between text-sm"
              >
                <span>{m.user?.name || "Unknown"}</span>
                <span className="text-gray-500">
                  {m.role || m.user?.role}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
