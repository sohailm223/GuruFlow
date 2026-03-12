import {
  LayoutDashboard,
  FolderKanban,
  Users,
  KeyRound
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
];
