import { listModels } from "@/lib/server/repo";

export async function GET() {
  return Response.json({ models: listModels() });
}
