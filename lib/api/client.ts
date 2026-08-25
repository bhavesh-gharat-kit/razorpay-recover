/**
 * Thin client-side fetch wrapper for the dashboard. Every API route in
 * this app returns the `{ ok: true, data }` / `{ ok: false, error }`
 * envelope from `lib/api/response.ts` — this unwraps it once so page
 * components never touch `response.ok` or `.json()` directly.
 */

export interface ApiErrorShape {
  code: string;
  message: string;
}

export class ApiRequestError extends Error {
  code: string;
  status: number;

  constructor(status: number, error: ApiErrorShape) {
    super(error.message);
    this.name = "ApiRequestError";
    this.code = error.code;
    this.status = status;
  }
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON response (e.g. a proxy error page) — fall through to the
    // generic error below.
  }

  if (
    !json ||
    typeof json !== "object" ||
    !("ok" in json)
  ) {
    throw new ApiRequestError(res.status, {
      code: "INVALID_RESPONSE",
      message: `Server returned an unexpected response (HTTP ${res.status})`,
    });
  }

  const envelope = json as { ok: boolean; data?: T; error?: ApiErrorShape };
  if (!envelope.ok) {
    throw new ApiRequestError(
      res.status,
      envelope.error ?? { code: "UNKNOWN_ERROR", message: "Request failed" },
    );
  }
  return envelope.data as T;
}
