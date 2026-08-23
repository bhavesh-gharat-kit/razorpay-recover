import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Future uptime monitors hit this route. It reports app liveness plus a
// real database round-trip so a "200 OK" here actually means the app can
// serve requests, not just that the process is running.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      status: "ok",
      db: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        db: "unreachable",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
