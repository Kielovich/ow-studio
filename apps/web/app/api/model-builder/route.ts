import { connection } from "next/server";
import { guard } from "@/lib/auth";
import { BUILDER_IMAGE_COST, createDraft, listOpenDrafts } from "@/lib/server/builder";
import { budgetRemaining } from "@/lib/server/repo";

// Reads the database (synchronous node:sqlite, invisible to the prerenderer): always run at request time.
export async function GET() {
  await connection();
  return Response.json({ drafts: listOpenDrafts(), imageCostUsd: BUILDER_IMAGE_COST, budgetRemainingUsd: budgetRemaining() });
}

/** Body: { spec }. A new model draft from the builder's choices; nothing is generated yet. */
export async function POST(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    return Response.json({ id: createDraft(body?.spec) }, { status: 201 });
  } catch (e) {
    return Response.json({ error: `These choices are not valid: ${(e as Error).message}` }, { status: 400 });
  }
}
