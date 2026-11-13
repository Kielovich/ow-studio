import { guard } from "@/lib/auth";
import { retryImage } from "@/lib/server/repo";

/**
 * Explicit approval of a new paid attempt. The only way out of awaiting_approval, failed or needs_review, and the only
 * way to replace a finished image (after its latest attempt was rejected). Earlier attempts are kept.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/images/[id]/approve">) {
  const denied = await guard(req);
  if (denied) return denied;
  const r = await retryImage((await ctx.params).id);
  return Response.json(r, { status: "error" in r ? 409 : 200 });
}
