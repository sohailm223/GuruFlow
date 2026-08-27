export default function TeamSummary({ title, members = [] }) {
  if (!members.length) return null;

  return (
    <div className="border rounded p-4">
      <h2 className="font-semibold mb-3">{title}</h2>

      <div className="space-y-3">
        {members.map((m, i) => (
          <div key={i} className="flex items-center gap-3">
            <img
              src={m.image || "/avatar.png"}
              alt={m.name}
              className="w-10 h-10 rounded-full"
            />
            <div>
              <p className="font-medium">{m.name}</p>
              <p className="text-xs text-gray-500">{m.role}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
