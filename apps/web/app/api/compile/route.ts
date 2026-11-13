import { previewDraft, type ProductionDraft } from "@/lib/server/repo";

export async function POST(req: Request) {
  try {
    return Response.json(await previewDraft((await req.json()) as ProductionDraft));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
