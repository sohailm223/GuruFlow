export default function ProjectMeta({
  startDate,
  endDate,
  liveDate,
  liveUrl,
  devUrl,
  budget,
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Box label="Start Date" value={new Date(startDate).toDateString()} />
      <Box label="End Date" value={new Date(endDate).toDateString()} />
      <Box label="Live Date" value={liveDate || "Not live"} />
      <Box label="Budget" value={`$ ${budget}`} />

      {liveUrl && (
        <a href={liveUrl} className="text-blue-600 underline">
          Live Site
        </a>
      )}

      {devUrl && (
        <a href={devUrl} className="text-blue-600 underline">
          Dev Site
        </a>
      )}
    </div>
  );
}

function Box({ label, value }) {
  return (
    <div className="bg-gray-50 p-4 rounded-lg">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}
