import { prisma } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api/response";

// Future uptime monitors hit this route. It reports app liveness plus a
// real database round-trip so a "200 OK" here actually means the app can
// serve requests, not just that the process is running.
export async function GET() {
  try {
    const merchantCount = await prisma.merchant.count();

    return successResponse({
      db: "connected",
      merchants: merchantCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(
      "DB_UNREACHABLE",
      error instanceof Error ? error.message : "Unknown database error",
    );
  }
}
