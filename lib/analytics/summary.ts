/**
 * Analytics summary — produces the "measured money recovered" numbers
 * the buildathon track asks for. Every field is derivable from the
 * existing tables; no dedicated stats/materialized view.
 *
 * Filters: `scenario` and a `[from, to]` window. If unset, "all time".
 *
 * All money is in paise; the caller formats rupees for display.
 */

import { prisma } from "@/lib/db";
import {
  Actor,
  CaseState,
  Channel,
  DeliveryStatus,
  type Scenario,
} from "@prisma/client";

export interface SummaryFilters {
  scenario?: Scenario;
  from?: Date;
  to?: Date;
}

export interface CauseBreakdown {
  causeCode: string;
  detected: number;
  recovered: number;
  recoveryRate: number;
}

export interface ChannelBreakdown {
  channel: Channel;
  sent: number;
  delivered: number;
  recoveryRate: number;
}

export interface DailyTrendPoint {
  date: string; // YYYY-MM-DD (UTC)
  detected: number;
  recovered: number;
  recoveredPaise: number;
}

export interface AnalyticsSummary {
  window: { from: Date | null; to: Date | null };
  scenario: Scenario | null;
  totalDetected: number;
  totalAtRiskPaise: number;
  totalRecoveredPaise: number;
  recoveryRate: number;
  avgTimeToRecoveryMinutes: number | null;
  humanInterventions: number;
  breakdownByCauseCode: CauseBreakdown[];
  breakdownByChannel: ChannelBreakdown[];
  dailyTrend: DailyTrendPoint[];
}

function dateKeyUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function computeAnalyticsSummary(
  filters: SummaryFilters = {},
): Promise<AnalyticsSummary> {
  const caseWhere = {
    ...(filters.scenario
      ? { recoveryEvent: { scenario: filters.scenario } }
      : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  };

  // Pull the cases in the window with just what we need.
  const cases = await prisma.case.findMany({
    where: caseWhere,
    select: {
      id: true,
      state: true,
      createdAt: true,
      recoveredAmountPaise: true,
      classifiedCase: { select: { causeCode: true } },
      recoveryEvent: { select: { amountPaise: true, scenario: true } },
      transitions: {
        select: { toState: true, createdAt: true, actor: true },
      },
      draftMessages: {
        select: {
          channel: true,
          deliveryAttempts: { select: { status: true } },
        },
      },
    },
  });

  // --- Headline numbers ---
  const totalDetected = cases.length;
  let totalAtRiskPaise = 0;
  let totalRecoveredPaise = 0;
  let humanInterventions = 0;

  // --- Time-to-recovery: DETECTED transition → RECOVERED transition. ---
  const recoveryDurationsMs: number[] = [];

  // --- Breakdowns ---
  const byCause: Record<string, { detected: number; recovered: number }> = {};
  const byChannel: Record<
    string,
    { sent: number; delivered: number; recoveredCases: Set<string> }
  > = {};
  const daily: Record<string, DailyTrendPoint> = {};

  for (const c of cases) {
    totalAtRiskPaise += c.recoveryEvent.amountPaise;

    const isRecovered = c.state === CaseState.RECOVERED;
    if (isRecovered) {
      totalRecoveredPaise += c.recoveredAmountPaise ?? c.recoveryEvent.amountPaise;
    }

    // Human interventions — any HUMAN transition on this case.
    if (c.transitions.some((t) => t.actor === Actor.HUMAN)) {
      humanInterventions++;
    }

    // Time to recovery — first DETECTED transition to first RECOVERED transition.
    if (isRecovered) {
      const detectedAt = c.transitions
        .filter((t) => t.toState === CaseState.DETECTED)
        .map((t) => t.createdAt.getTime())
        .sort((a, b) => a - b)[0];
      const recoveredAt = c.transitions
        .filter((t) => t.toState === CaseState.RECOVERED)
        .map((t) => t.createdAt.getTime())
        .sort((a, b) => a - b)[0];
      if (detectedAt && recoveredAt && recoveredAt > detectedAt) {
        recoveryDurationsMs.push(recoveredAt - detectedAt);
      }
    }

    // Cause-code breakdown.
    const cause = c.classifiedCase?.causeCode ?? "UNCLASSIFIED";
    const bc = (byCause[cause] ??= { detected: 0, recovered: 0 });
    bc.detected++;
    if (isRecovered) bc.recovered++;

    // Channel breakdown — one draft per attempt. "sent" = any attempt on
    // the channel; "delivered" = at least one SENT DeliveryAttempt on
    // that channel; recoveryRate is (cases recovered / cases sent) for
    // that channel.
    const channelsTouched = new Set<Channel>();
    for (const d of c.draftMessages) {
      channelsTouched.add(d.channel);
      const chStats = (byChannel[d.channel] ??= {
        sent: 0,
        delivered: 0,
        recoveredCases: new Set<string>(),
      });
      // Count the draft as "sent" only when a delivery attempt exists.
      const anyAttempt = d.deliveryAttempts.length > 0;
      const anySent = d.deliveryAttempts.some(
        (a) => a.status === DeliveryStatus.SENT,
      );
      if (anyAttempt) chStats.sent++;
      if (anySent) chStats.delivered++;
    }
    if (isRecovered) {
      Array.from(channelsTouched).forEach((ch) => {
        byChannel[ch]?.recoveredCases.add(c.id);
      });
    }

    // Daily trend — bucket by UTC date of case createdAt for "detected"
    // and by RECOVERED transition time for "recovered".
    const detectedKey = dateKeyUTC(c.createdAt);
    const point = (daily[detectedKey] ??= {
      date: detectedKey,
      detected: 0,
      recovered: 0,
      recoveredPaise: 0,
    });
    point.detected++;

    if (isRecovered) {
      const recoveredTransition = c.transitions.find(
        (t) => t.toState === CaseState.RECOVERED,
      );
      const recoveredDate = recoveredTransition?.createdAt ?? c.createdAt;
      const key = dateKeyUTC(recoveredDate);
      const p = (daily[key] ??= {
        date: key,
        detected: 0,
        recovered: 0,
        recoveredPaise: 0,
      });
      p.recovered++;
      p.recoveredPaise += c.recoveredAmountPaise ?? c.recoveryEvent.amountPaise;
    }
  }

  const recoveryRate =
    totalAtRiskPaise > 0 ? totalRecoveredPaise / totalAtRiskPaise : 0;

  const avgTimeToRecoveryMinutes =
    recoveryDurationsMs.length > 0
      ? recoveryDurationsMs.reduce((a, b) => a + b, 0) /
        recoveryDurationsMs.length /
        (1000 * 60)
      : null;

  const breakdownByCauseCode: CauseBreakdown[] = Object.entries(byCause)
    .map(([causeCode, v]) => ({
      causeCode,
      detected: v.detected,
      recovered: v.recovered,
      recoveryRate: v.detected > 0 ? v.recovered / v.detected : 0,
    }))
    .sort((a, b) => b.detected - a.detected);

  const breakdownByChannel: ChannelBreakdown[] = Object.entries(byChannel).map(
    ([channel, v]) => ({
      channel: channel as Channel,
      sent: v.sent,
      delivered: v.delivered,
      recoveryRate: v.sent > 0 ? v.recoveredCases.size / v.sent : 0,
    }),
  );

  const dailyTrend = Object.values(daily).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  return {
    window: { from: filters.from ?? null, to: filters.to ?? null },
    scenario: filters.scenario ?? null,
    totalDetected,
    totalAtRiskPaise,
    totalRecoveredPaise,
    recoveryRate,
    avgTimeToRecoveryMinutes,
    humanInterventions,
    breakdownByCauseCode,
    breakdownByChannel,
    dailyTrend,
  };
}
