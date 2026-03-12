export default function ProjectHeader({ title, logo, status }) {
  return (
    <div className="flex items-center justify-between border-b pb-4">
      <div className="flex items-center gap-4">
        {logo && (
          <img src={logo} className="w-12 h-12 rounded-full object-cover" />
        )}
        <h1 className="text-2xl font-bold">{title}</h1>
      </div>

      <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-700">
        {status}
      </span>
    </div>
  );
}
