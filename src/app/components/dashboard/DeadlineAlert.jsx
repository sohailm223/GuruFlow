export default function DeadlineAlert({ projects = [] }) {
  const nearDeadline = projects.filter(
    (p) => p.remainingDays !== null && p.remainingDays <= 5
  );

  if (!nearDeadline.length) return null;

  return (
    <div className="border border-red-300 bg-red-50 rounded p-4">
      <h2 className="font-semibold text-red-600 mb-2">
        Deadlines Near 🚨
      </h2>

      <ul className="text-sm">
        {nearDeadline.map((p) => (
          <li key={p.id}>
            {p.name} – {p.remainingDays} days left
          </li>
        ))}
      </ul>
    </div>
  );
}
