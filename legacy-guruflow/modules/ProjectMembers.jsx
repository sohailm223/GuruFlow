export default function ProjectMembers({ members = [] }) {
  if (!members.length) return null;

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Project Team</h2>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {members.map((m, i) => {
          const hasImage = m?.user?.imageUrl;

          return (
            <div
              key={i}
              className="flex items-center gap-3 border p-3 rounded"
            >
              {hasImage ? (
                <img
                  src={m.user.imageUrl}
                  alt={m.user.name}
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-sm font-semibold text-gray-700">
                  {m.user?.name?.charAt(0) || "?"}
                </div>
              )}

              <div>
                <p className="font-semibold">{m.user?.name}</p>

                {m.role && (
                  <p className="text-sm text-gray-500">{m.role}</p>
                )}

                {m.user?.email && (
                  <p className="text-xs text-gray-400">
                    {m.user.email}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
