import { SESSION_COOKIE } from "@/lib/auth";

export async function POST() {
  return Response.json({ ok: true }, { headers: { "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } });
}
