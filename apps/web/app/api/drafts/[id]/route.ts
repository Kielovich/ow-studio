import { getDraft, isDraftId, saveDraft } from "@/lib/server/repo";

/** Import sessions: the new-production form, saved on the server so corrections survive a closed tab. */
export async function GET(_: Request, ctx: RouteContext<"/api/drafts/[id]">) {
  const d = getDraft((await ctx.params).id);
  return d ? Response.json(d) : Response.json({ error: "not found" }, { status: 404 });
}

export async function PUT(req: Request, ctx: RouteContext<"/api/drafts/[id]">) {
  const id = (await ctx.params).id;
  if (!isDraftId(id)) return Response.json({ error: "Invalid draft id" }, { status: 400 });
  try {
    const d = saveDraft(id, await req.json());
    return Response.json({ id: d.id, updatedAt: d.updatedAt, productionId: d.productionId });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
