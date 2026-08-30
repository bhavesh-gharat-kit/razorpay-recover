import { redirect } from "next/navigation";
import { getSessionFromCookieStore } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

/**
 * Server-side role guard for /settings/policies — only ADMINs
 * should be able to access policy management. VIEWERs and REVIEWERs
 * are redirected to the dashboard.
 */
export default async function PoliciesLayout({
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
    select: { role: true },
  });

  if (!user || user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
