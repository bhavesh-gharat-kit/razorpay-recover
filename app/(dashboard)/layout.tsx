import { redirect } from "next/navigation";
import { getSessionFromCookieStore } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { Sidebar, type CurrentUser } from "@/components/Sidebar";

/**
 * Auth-gated shell for every dashboard route. Redirects to /login when
 * there's no valid session cookie. Looks the user up fresh (rather than
 * trusting only the JWT payload) so a deleted/demoted user doesn't keep a
 * stale role rendered client-side.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = getSessionFromCookieStore();
  if (!session) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, role: true },
  });
  if (!user) {
    redirect("/login");
  }

  const currentUser: CurrentUser = { userId: user.id, email: user.email, role: user.role };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950 md:flex-row">
      <aside className="w-full border-b border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:h-screen md:w-64 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
        <Sidebar user={currentUser} />
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
    </div>
  );
}
