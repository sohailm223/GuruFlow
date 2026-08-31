import { ShieldAlert, ShieldCheck, CircleSlash } from "lucide-react";

/**
 * Roster of WordPress accounts plus the on-server weak/strong password audit.
 * Only a boolean flag is ever shown — the password and its hash never leave
 * the WordPress site, so nothing recoverable is displayed here.
 */
export default function UsersPanel({ snapshot }) {
  if (!snapshot) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm font-medium text-slate-900">No user snapshot yet</p>
        <p className="mt-1 text-sm text-slate-500">
          The collector sends a daily roster with a weak/strong password audit.
        </p>
      </div>
    );
  }

  const users = snapshot.metadata?.users ?? [];
  const weak = users.filter((u) => u.weak === true);
  const admins = users.filter((u) => u.isAdmin);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-slate-100 px-5 py-3">
        <p className="text-sm text-slate-600">
          <strong className="text-slate-900">{snapshot.metadata?.total ?? users.length}</strong> accounts
        </p>
        <p className="text-sm text-slate-600">
          <strong className="text-slate-900">{admins.length}</strong> admin{admins.length === 1 ? "" : "s"}
        </p>
        <p className={`text-sm ${weak.length ? "text-rose-700" : "text-teal-700"}`}>
          <strong>{weak.length}</strong> weak password{weak.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2 font-medium">User</th>
              <th className="px-5 py-2 font-medium">Role</th>
              <th className="px-5 py-2 font-medium">Registered</th>
              <th className="px-5 py-2 font-medium">Password</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {users.map((u) => (
              <tr key={u.userId}>
                <td className="px-5 py-2.5">
                  <span className="font-medium text-slate-900">{u.username}</span>
                  {u.isAdmin && (
                    <span className="ml-2 rounded bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700">
                      admin
                    </span>
                  )}
                  {u.predictable && (
                    <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                      predictable
                    </span>
                  )}
                  <span className="block text-xs text-slate-400">{u.email}</span>
                </td>
                <td className="px-5 py-2.5 text-slate-600">{(u.roles ?? []).join(", ") || "—"}</td>
                <td className="px-5 py-2.5 text-slate-600">
                  {u.registered ? new Date(u.registered).toLocaleDateString() : "—"}
                </td>
                <td className="px-5 py-2.5">
                  <PasswordBadge weak={u.weak} risky={u.isAdmin || u.predictable} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PasswordBadge({ weak, risky }) {
  if (weak === true) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
        <ShieldAlert size={12} /> Weak{risky ? " · high risk" : ""}
      </span>
    );
  }
  if (weak === false) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
        <ShieldCheck size={12} /> Not in common list
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
      <CircleSlash size={12} /> Not audited
    </span>
  );
}
