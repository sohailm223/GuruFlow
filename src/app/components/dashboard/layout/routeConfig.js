export const ROUTE_CONFIG = {
  dashboard: {
    label: 'Dashboard',
  },
  projects: {
    label: 'Projects',
    children: {
      new: { label: 'New Project' },
      edit: { label: 'Edit Project' },
    },
  },
  users: {
    label: 'Team',
  },
  credentials: {
    label: 'Credentials',
  },
};

/* Fallback for dynamic routes like [slug], [id] */
export function formatSegment(segment) {
  if (!segment) return '';

  return segment
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
