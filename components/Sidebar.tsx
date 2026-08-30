"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { UserRole } from "@prisma/client";
import { apiFetch } from "@/lib/api/client";

export interface CurrentUser {
  userId: string;
  email: string;
  role: UserRole;
}

interface NavItem {
  href: string;
  label: string;
  /** Roles allowed to see this item at all. Omit = everyone signed in. */
  roles?: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Summary" },
  { href: "/cases", label: "Cases" },
  { href: "/approvals", label: "Approvals", roles: ["ADMIN", "REVIEWER"] },
  { href: "/audit", label: "Audit" },
  { href: "/settings/policies", label: "Policies", roles: ["ADMIN"] },
];

export function Sidebar({ user }: { user: CurrentUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const [approvalCount, setApprovalCount] = useState<number | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const canSeeApprovals = user.role === "ADMIN" || user.role === "REVIEWER";

  useEffect(() => {
    if (!canSeeApprovals) return;
    let cancelled = false;
    const load = () => {
      apiFetch<{ count: number }>("/api/approvals")
        .then((data) => {
          if (!cancelled) setApprovalCount(data.count);
        })
        .catch(() => {
          /* non-fatal — badge just stays stale */
        });
    };
    load();
    // Light poll as a fallback; the dashboard pages also nudge this via SSE
    // event handling where relevant, but a plain interval keeps the badge
    // honest even when the user is sitting on a page that ignores SSE.
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [canSeeApprovals]);

  async function handleLogout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const visibleItems = NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(user.role));

  const navLinks = (
    <ul className="space-y-1">
      {visibleItems.map((item) => {
        const active = pathname === item.href;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              <span>{item.label}</span>
              {item.href === "/approvals" && approvalCount != null && approvalCount > 0 && (
                <span className="ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-white">
                  {approvalCount}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  const userSection = (
    <div className="border-t border-slate-200 px-2 py-3 dark:border-slate-700">
      <div className="mb-2 flex items-center gap-2">
        <span className="truncate text-sm text-slate-700 dark:text-slate-300" title={user.email}>
          {user.email}
        </span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {user.role}
        </span>
      </div>
      <button
        onClick={handleLogout}
        className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        Log out
      </button>
    </div>
  );

  return (
    <nav className="flex h-full flex-col justify-between">
      {/* Mobile: compact header row with hamburger */}
      <div className="flex items-center justify-between md:hidden">
        <span className="px-2 text-lg font-bold text-slate-900 dark:text-slate-100">Recover</span>
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="rounded-md p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          aria-label="Toggle navigation"
        >
          {mobileOpen ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
            </svg>
          )}
        </button>
      </div>
      {/* Mobile: expandable nav */}
      {mobileOpen && (
        <div className="mt-2 md:hidden">
          {navLinks}
          {userSection}
        </div>
      )}
      {/* Desktop: always-visible sidebar */}
      <div className="hidden md:block">
        <div className="mb-6 px-2">
          <span className="text-lg font-bold text-slate-900 dark:text-slate-100">Recover</span>
        </div>
        {navLinks}
      </div>
      <div className="hidden md:block">
        {userSection}
      </div>
    </nav>
  );
}
