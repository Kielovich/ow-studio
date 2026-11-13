import { guard } from "@/lib/auth";
import { setReview } from "@/lib/server/repo";

/** Approve or reject one attempt of an image: { attempt, decision: "approved" | "rejected" | null }. Free; nothing is generated. */
export async function POST(req: Request, ctx: RouteContext<"/api/images/[id]/review">) {
  const denied = await guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { attempt?: number; decision?: string | null };
  if (typeof body.attempt !== "number" || !["approved", "rejected", null].includes(body.decision ?? null)) {
    return Response.json({ error: "Expected { attempt: number, decision: 'approved' | 'rejected' | null }" }, { status: 400 });
  }
  const r = setReview((await ctx.params).id, body.attempt, (body.decision ?? null) as "approved" | "rejected" | null);
  return Response.json(r, { status: "error" in r ? 409 : 200 });
}
