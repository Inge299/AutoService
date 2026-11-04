import { NextResponse } from "next/server";
import {
  AutoServiceApiError,
  submitPublicApprovalDecision,
  type ApprovalDecisionValue,
} from "@/lib/api/autoservice-api";

const allowedDecisions = new Set<ApprovalDecisionValue>([
  "APPROVED",
  "DECLINED",
  "DEFERRED",
  "CALL_REQUESTED",
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = await request.json().catch(() => null) as { value?: unknown } | null;
  if (!body || typeof body.value !== "string" || !allowedDecisions.has(body.value as ApprovalDecisionValue)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const decision = await submitPublicApprovalDecision(token, body.value as ApprovalDecisionValue);
    return NextResponse.json(decision);
  } catch (error) {
    if (error instanceof AutoServiceApiError) {
      const upstream = (() => { try { return JSON.parse(error.body) as { error?: string }; } catch { return {}; } })();
      const code = ["decision_already_recorded", "visit_closed", "link_unavailable", "not_found"].includes(upstream.error ?? "")
        ? upstream.error : "approval_unavailable";
      return NextResponse.json({ error: code }, { status: error.status });
    }
    return NextResponse.json({ error: "backend_unavailable" }, { status: 502 });
  }
}
