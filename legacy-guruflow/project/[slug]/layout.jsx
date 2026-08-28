export default async function ProjectLayout({ children, params }) {
  const { projectId } = await params;

  return (
    <div className="p-6">
      {children}
    </div>
  );
}
