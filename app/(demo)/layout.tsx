/**
 * Public layout for the /demo route group. Deliberately does not include
 * the dashboard's Sidebar, auth check, or session cookie read — the whole
 * point of /demo is that a judge can try it without an account.
 */

export default function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="sticky top-0 z-40 border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        ⚠️ TEST MODE — no real money moves. Uses Razorpay test-mode keys and
        the Brevo free tier.
      </div>
      <main className="mx-auto max-w-3xl px-4 py-8 md:py-12">{children}</main>
    </div>
  );
}
