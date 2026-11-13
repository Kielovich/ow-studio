import { authMode, clearLoginFailures, createSession, loginBlocked, passwordMatches, recordLoginFailure, SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: Request) {
  const mode = authMode();
  if (mode === "closed") return Response.json({ error: "Not configured" }, { status: 503 });
  if (mode === "open") return Response.json({ ok: true });
  const client = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (loginBlocked(client)) return Response.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (typeof password !== "string" || !(await passwordMatches(password))) {
    recordLoginFailure(client);
    await new Promise((r) => setTimeout(r, 400));
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }
  clearLoginFailures(client);
  const { token, expires } = await createSession(process.env.OW_SESSION_SECRET!);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return Response.json({ ok: true }, {
    headers: { "set-cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure}` },
  });
}
