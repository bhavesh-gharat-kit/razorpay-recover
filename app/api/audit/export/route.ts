/**
 * GET /api/audit/export?caseId=...&format=csv
 *
 * CSV export of a case's audit timeline. Currently only `format=csv`
 * is supported; other formats return 400 (leaves room for `xlsx` later).
 */

import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/response";
import { requireRole } from "@/lib/auth/requireRole";
import { buildCaseTimeline } from "@/lib/audit/timeline";
import { prisma } from "@/lib/db";
import { UserRole } from "@prisma/client";

/** Escape a value for a CSV cell — quote when needed. */
function csvCell(value: unknown): string {
  const s =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const COLUMNS = [
  "createdAt",
  "source",
  "actor",
  "actorEmail",
  "action",
  "reasonCode",
  "fromState",
  "toState",
  "description",
  "beforeState",
  "afterState",
  "metadata",
];

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, [
    UserRole.ADMIN,
    UserRole.REVIEWER,
    UserRole.VIEWER,
  ]);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const caseId = searchParams.get("caseId");
  const format = (searchParams.get("format") ?? "csv").toLowerCase();

  if (!caseId) {
    return errorResponse("MISSING_CASE_ID", "Query param `caseId` is required", 400);
  }
  if (format !== "csv") {
    return errorResponse(
      "UNSUPPORTED_FORMAT",
      `Only format=csv is supported (got "${format}")`,
      400,
    );
  }

  const caseExists = await prisma.case.findUnique({
    where: { id: caseId },
    select: { id: true },
  });
  if (!caseExists) {
    return errorResponse("NOT_FOUND", `Case ${caseId} not found`, 404);
  }

  const timeline = await buildCaseTimeline(caseId);

  const lines: string[] = [COLUMNS.join(",")];
  for (const e of timeline) {
    lines.push(
      [
        e.createdAt.toISOString(),
        e.source,
        e.actor,
        e.actorEmail ?? "",
        e.action,
        e.reasonCode ?? "",
        e.fromState ?? "",
        e.toState ?? "",
        e.description,
        e.beforeState,
        e.afterState,
        e.metadata,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const csv = lines.join("\n") + "\n";
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-${caseId}.csv"`,
    },
  });
}
