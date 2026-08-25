"use client";

import { useEffect, useState } from "react";
import type { UserRole } from "@prisma/client";
import { apiFetch } from "@/lib/api/client";

export interface CurrentUserInfo {
  userId: string;
  email: string;
  role: UserRole;
}

/**
 * Fetches `GET /api/auth/me` once on mount. The dashboard layout already
 * gates page access server-side; this is only for client components that
 * need the role to decide which action buttons to show/enable.
 */
export function useCurrentUser(): { user: CurrentUserInfo | null; loading: boolean } {
  const [user, setUser] = useState<CurrentUserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch<CurrentUserInfo>("/api/auth/me")
      .then((data) => {
        if (!cancelled) setUser(data);
      })
      .catch(() => {
        /* layout already redirects unauthenticated users */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { user, loading };
}
