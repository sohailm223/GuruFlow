export default async function TimelinePage({ params }) {
  const { slug } = await params;

  return (
    <div>
      <h1 className="text-xl font-semibold">
        Timeline
      </h1>

      <p className="text-sm text-gray-500">
        Project: {slug}
      </p>
    </div>
  );
}
