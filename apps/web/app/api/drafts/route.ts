import { connection } from "next/server";
import { listDrafts } from "@/lib/server/repo";

// Reads the database (synchronous node:sqlite, invisible to the prerenderer): always run at request time.
export async function GET() {
  await connection();
  return Response.json({ drafts: listDrafts() });
}
