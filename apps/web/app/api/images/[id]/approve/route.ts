import { approveRetry } from "@ow-studio/core";
import { SqliteJobStore } from "@/lib/server/jobstore";

/** Explicit approval of a paid retry. The only way out of awaiting_approval, failed or needs_review. */
export async function POST(_: Request, ctx: RouteContext<"/api/images/[id]/approve">) {
  try {
    const job = await approveRetry(new SqliteJobStore(), (await ctx.params).id);
    return Response.json({ state: job.state });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 409 });
  }
}
