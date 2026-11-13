import { overview } from "@/lib/server/repo";

export async function GET() {
  return Response.json(overview());
}
