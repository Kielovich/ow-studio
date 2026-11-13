import { connection } from "next/server";
import { getDb } from "@/lib/server/db";

/** Platform health check (no session needed, no data returned): the database opens and answers. */
export async function GET() {
  await connection();
  try {
    getDb().prepare("SELECT 1").get();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
