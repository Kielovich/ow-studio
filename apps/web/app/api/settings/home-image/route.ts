import { connection } from "next/server";
import { guard } from "@/lib/auth";
import { homeImage, homeImageCandidates, setHomeImage } from "@/lib/server/repo";

/** The approved images that can be the Ecom picture on the overview, and the one chosen (null: a model portrait). */
export async function GET() {
  await connection();
  return Response.json({ current: homeImage(), candidates: homeImageCandidates() });
}

/** Body: { hash } to choose an approved image, or { hash: null } for a model portrait again. */
export async function POST(req: Request) {
  const denied = await guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { hash?: unknown };
  const hash = body.hash === null ? null : typeof body.hash === "string" ? body.hash : undefined;
  if (hash === undefined) return Response.json({ error: "Send { hash } or { hash: null }." }, { status: 400 });
  const r = setHomeImage(hash);
  return "error" in r ? Response.json(r, { status: 400 }) : Response.json({ current: homeImage() });
}
