import { guard } from "@/lib/auth";
import { requestEdit } from "@/lib/server/repo";

/** Queue a paid hand fix of one attempt: { attempt, x, y (0..1), createKey }. Same createKey, same edit. */
export async function POST(req: Request, ctx: RouteContext<"/api/images/[id]/edits">) {
  const denied = await guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { attempt?: number; x?: number; y?: number; createKey?: string };
  if (typeof body.attempt !== "number" || typeof body.x !== "number" || typeof body.y !== "number") {
    return Response.json({ error: "Expected { attempt, x, y, createKey }" }, { status: 400 });
  }
  const r = requestEdit((await ctx.params).id, { attempt: body.attempt, x: body.x, y: body.y, createKey: body.createKey });
  return Response.json(r, { status: "error" in r ? 409 : "existing" in r && r.existing ? 200 : 201 });
}
