"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiRequestError } from "@/lib/api/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="mb-1 text-2xl font-bold text-slate-900 dark:text-slate-100">Recover</h1>
        <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
          Sign in to the revenue recovery dashboard.
        </p>

        {/* Quick-access demo credentials for judges / reviewers */}
        <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700/60 dark:bg-slate-800/60">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Demo accounts <span className="font-normal normal-case tracking-normal">· password: <code className="rounded bg-slate-200 px-1 py-0.5 text-xs dark:bg-slate-700">recover123</code></span>
          </p>
          <div className="space-y-1.5">
            {[
              { email: "admin@recover.test", role: "Admin", desc: "Full access" },
              { email: "reviewer@recover.test", role: "Reviewer", desc: "Approve / reject" },
              { email: "viewer@recover.test", role: "Viewer", desc: "Read only" },
            ].map(({ email: cred, role, desc }) => (
              <button
                key={cred}
                type="button"
                onClick={() => { setEmail(cred); setPassword("recover123"); }}
                className="flex w-full items-center justify-between rounded-md border border-transparent px-2 py-1.5 text-left text-sm transition-colors hover:border-slate-300 hover:bg-white dark:hover:border-slate-600 dark:hover:bg-slate-700/60"
              >
                <span className="font-medium text-slate-700 dark:text-slate-200">{cred}</span>
                <span className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="rounded bg-slate-200 px-1.5 py-0.5 font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">{role}</span>
                  <span>{desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
