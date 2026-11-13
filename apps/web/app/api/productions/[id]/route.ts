import { guard } from "@/lib/auth";
import { deleteProduction, getProduction } from "@/lib/server/repo";

export async function GET(_: Request, ctx: RouteContext<"/api/productions/[id]">) {
  const p = getProduction((await ctx.params).id);
  return p ? Response.json(p) : Response.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/productions/[id]">) {
  const denied = await guard(req);
  if (denied) return denied;
  const r = deleteProduction((await ctx.params).id);
  return Response.json(r, { status: "error" in r ? 409 : 200 });
}
