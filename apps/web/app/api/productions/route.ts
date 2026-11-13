import { guard } from "@/lib/auth";
import { createProduction, listProductions, type ProductionDraft } from "@/lib/server/repo";

export async function GET() {
  return Response.json({ productions: listProductions() });
}

/**
 * Body: { draft, createKey, draftId? } (or a bare draft, without idempotency). The same createKey always returns the
 * same production, so a double click or a retried request never creates a second paid production.
 */
export async function POST(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    const wrapped = body && typeof body === "object" && "draft" in body;
    const draft = (wrapped ? body.draft : body) as ProductionDraft;
    const r = await createProduction(draft, wrapped ? { createKey: body.createKey, draftId: body.draftId } : {});
    return Response.json(r, { status: "error" in r ? 409 : "existing" in r && r.existing ? 200 : 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
