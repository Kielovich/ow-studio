import { createProduction, listProductions, type ProductionDraft } from "@/lib/server/repo";

export async function GET() {
  return Response.json({ productions: listProductions() });
}

export async function POST(req: Request) {
  try {
    const r = await createProduction((await req.json()) as ProductionDraft);
    return Response.json(r, { status: "error" in r ? 409 : 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
