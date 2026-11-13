import { listDrafts } from "@/lib/server/repo";

export async function GET() {
  return Response.json({ drafts: listDrafts() });
}
