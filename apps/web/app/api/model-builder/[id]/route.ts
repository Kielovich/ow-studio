import { connection } from "next/server";
import { guard } from "@/lib/auth";
import {
  BuilderError, choosePortrait, discardDraft, getDraft, queuePortraits, queueReferences, redoReference, registerDraft, updateSpec,
} from "@/lib/server/builder";

const fail = (e: unknown) =>
  e instanceof BuilderError
    ? Response.json({ error: e.message }, { status: e.status })
    : Response.json({ error: (e as Error).message }, { status: 400 });

export async function GET(_: Request, ctx: RouteContext<"/api/model-builder/[id]">) {
  await connection();
  const d = getDraft((await ctx.params).id);
  return d ? Response.json(d) : Response.json({ error: "not found" }, { status: 404 });
}

/** Body: { spec }. New choices, before the reference set is made. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/model-builder/[id]">) {
  const denied = await guard(req);
  if (denied) return denied;
  const id = (await ctx.params).id;
  try {
    updateSpec(id, (await req.json())?.spec);
    return Response.json(getDraft(id));
  } catch (e) { return fail(e); }
}

/**
 * Body: { action } with
 *   "portraits"                  a round of portrait candidates (paid)
 *   "choose", imageId            the portrait the reference set is made from
 *   "references"                 every reference not made yet (paid)
 *   "redo", kind                 one reference again (paid)
 *   "register", name             add her to the models
 */
export async function POST(req: Request, ctx: RouteContext<"/api/model-builder/[id]">) {
  const denied = await guard(req);
  if (denied) return denied;
  const id = (await ctx.params).id;
  try {
    const body = (await req.json()) as { action?: string; imageId?: string; kind?: string; name?: string };
    switch (body.action) {
      case "portraits": queuePortraits(id); break;
      case "choose": choosePortrait(id, String(body.imageId ?? "")); break;
      case "references": queueReferences(id); break;
      case "redo": redoReference(id, String(body.kind ?? "")); break;
      case "register": return Response.json({ modelId: await registerDraft(id, body.name) }, { status: 201 });
      default: return Response.json({ error: "Unknown action" }, { status: 400 });
    }
    return Response.json(getDraft(id));
  } catch (e) { return fail(e); }
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/model-builder/[id]">) {
  const denied = await guard(req);
  if (denied) return denied;
  try {
    discardDraft((await ctx.params).id);
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
