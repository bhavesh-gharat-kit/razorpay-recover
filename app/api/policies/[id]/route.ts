/**
 * PATCH /api/policies/[id] — ADMIN only. Updates the mutable guardrail
 * fields on a `RecoveryPolicy` row: `cooldownMinutes`, `maxAttempts`,
 * `sendWindowStartHour`, `sendWindowEndHour`, `active`. `scenario` and
 * `causeCode` are immutable identity fields, not editable here.
 *
 * Writes an AuditLog entry with the full before/after so a live "change a
 * cooldown, re-run a batch" demo has a paper trail.
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireRole } from "@/lib/auth/requireRole";
import { prisma } from "@/lib/db";
import { Actor, UserRole } from "@prisma/client";

interface Body {
  cooldownMinutes?: unknown;
  maxAttempts?: unknown;
  sendWindowStartHour?: unknown;
  sendWindowEndHour?: unknown;
  active?: unknown;
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isHour(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 23;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireRole(request, [UserRole.ADMIN]);
  if (auth.response) return auth.response;
  const { session } = auth;

  const existing = await prisma.recoveryPolicy.findUnique({ where: { id: params.id } });
  if (!existing) {
    return errorResponse("NOT_FOUND", `Policy ${params.id} not found`, 404);
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return errorResponse("INVALID_JSON", "Malformed JSON body", 400);
  }

  const data: {
    cooldownMinutes?: number;
    maxAttempts?: number;
    sendWindowStartHour?: number;
    sendWindowEndHour?: number;
    active?: boolean;
  } = {};

  if (body.cooldownMinutes !== undefined) {
    if (!isPositiveInt(body.cooldownMinutes)) {
      return errorResponse("INVALID_COOLDOWN", "cooldownMinutes must be a non-negative integer", 400);
    }
    data.cooldownMinutes = body.cooldownMinutes;
  }
  if (body.maxAttempts !== undefined) {
    if (!isPositiveInt(body.maxAttempts) || body.maxAttempts < 1) {
      return errorResponse("INVALID_MAX_ATTEMPTS", "maxAttempts must be a positive integer", 400);
    }
    data.maxAttempts = body.maxAttempts;
  }
  if (body.sendWindowStartHour !== undefined) {
    if (!isHour(body.sendWindowStartHour)) {
      return errorResponse("INVALID_HOUR", "sendWindowStartHour must be an integer 0-23", 400);
    }
    data.sendWindowStartHour = body.sendWindowStartHour;
  }
  if (body.sendWindowEndHour !== undefined) {
    if (!isHour(body.sendWindowEndHour)) {
      return errorResponse("INVALID_HOUR", "sendWindowEndHour must be an integer 0-23", 400);
    }
    data.sendWindowEndHour = body.sendWindowEndHour;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") {
      return errorResponse("INVALID_ACTIVE", "active must be a boolean", 400);
    }
    data.active = body.active;
  }

  const startHour = data.sendWindowStartHour ?? existing.sendWindowStartHour;
  const endHour = data.sendWindowEndHour ?? existing.sendWindowEndHour;
  if (startHour >= endHour) {
    return errorResponse(
      "INVALID_WINDOW",
      "sendWindowStartHour must be before sendWindowEndHour",
      400,
    );
  }

  if (Object.keys(data).length === 0) {
    return errorResponse("NO_FIELDS", "No editable fields provided", 400);
  }

  const before = {
    cooldownMinutes: existing.cooldownMinutes,
    maxAttempts: existing.maxAttempts,
    sendWindowStartHour: existing.sendWindowStartHour,
    sendWindowEndHour: existing.sendWindowEndHour,
    active: existing.active,
  };

  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.recoveryPolicy.update({
      where: { id: params.id },
      data,
    });

    await tx.auditLog.create({
      data: {
        entityType: "RecoveryPolicy",
        entityId: params.id,
        actor: Actor.HUMAN,
        actorUserId: session.userId,
        action: "policy_updated",
        reasonCode: "admin_edit",
        beforeState: before,
        afterState: data,
      },
    });

    return updated;
  });

  return successResponse({ policy: updated });
}
