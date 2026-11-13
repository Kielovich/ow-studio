import { connection } from "next/server";
import { overview } from "@/lib/server/repo";

// Reads the database (synchronous node:sqlite, invisible to the prerenderer): always run at request time.
export async function GET() {
  await connection();
  return Response.json(overview());
}
