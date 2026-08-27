import {
  LayoutDashboard,
  FolderKanban,
  Users,
  KeyRound,
  Video
} from 'lucide-react';

export const navItems = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    label: 'Projects',
    href: '/projects',
    icon: FolderKanban,
  },
  {
    label: 'Team',
    href: '/users',
    icon: Users,
  },
  {
    label: 'Credentials',
    href: '/credentials',
    icon: KeyRound,
  },
  {
    label: 'Black Box',
    href: '/incidents',
    icon: Video,
  },
];
