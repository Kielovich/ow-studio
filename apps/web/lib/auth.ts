/**
 * Access control for the studio: one shared password, a signed session cookie, nothing else to configure.
 * Web Crypto only, so the same code runs in proxy.ts and in route handlers.
 *
 * Modes:
 * - "on":     OW_PASSWORD and OW_SESSION_SECRET are set; every page and API needs a valid session.
 * - "closed": production without that configuration; everything is refused (never silently open).
 * - "open":   local development without OW_PASSWORD; unchanged local workflow.
 */
export const SESSION_COOKIE = "ow_session";
export const SESSION_DAYS = 7;

export type AuthMode = "on" | "closed" | "open";

type Env = Record<string, string | undefined>;

export function authMode(env: Env = process.env): AuthMode {
  const ok = (env.OW_PASSWORD?.length ?? 0) >= 12 && (env.OW_SESSION_SECRET?.length ?? 0) >= 32;
  if (ok) return "on";
  return env.NODE_ENV === "production" ? "closed" : "open";
}

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer) => Buffer.from(new Uint8Array(buf)).toString("base64url");

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Constant-time comparison of two strings via their SHA-256 digests (equal length, no early exit). */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const x = new Uint8Array(da), y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

/** Token: "<expiry ms>.<hmac>". Stateless; changing OW_SESSION_SECRET signs everyone out. */
export async function createSession(secret: string, now = Date.now()): Promise<{ token: string; expires: Date }> {
  const exp = now + SESSION_DAYS * 24 * 3600 * 1000;
  return { token: `${exp}.${await hmac(secret, `v1:${exp}`)}`, expires: new Date(exp) };
}

export async function verifySession(token: string | undefined, secret: string, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const [expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!sig || !Number.isFinite(exp) || exp <= now) return false;
  return safeEqual(sig, await hmac(secret, `v1:${exp}`));
}

export async function passwordMatches(input: string, env: Env = process.env): Promise<boolean> {
  return !!env.OW_PASSWORD && safeEqual(input, env.OW_PASSWORD);
}

const cookieValue = (header: string | null, name: string) =>
  header?.split(/;\s*/).find((c) => c.startsWith(name + "="))?.slice(name.length + 1);

/** For route handlers: null when the request may proceed, otherwise the response to return. Defence in depth behind proxy.ts. */
export async function guard(req: Request, env: Env = process.env): Promise<Response | null> {
  const mode = authMode(env);
  if (mode === "open") return null;
  if (mode === "closed") return Response.json({ error: "Not configured: set OW_PASSWORD and OW_SESSION_SECRET" }, { status: 503 });
  return (await verifySession(cookieValue(req.headers.get("cookie"), SESSION_COOKIE), env.OW_SESSION_SECRET!))
    ? null
    : Response.json({ error: "Sign in required" }, { status: 401 });
}

/** Simple in-memory login throttle per client: 8 failed attempts per 15 minutes. */
const failures = new Map<string, { n: number; until: number }>();
export function loginBlocked(client: string, now = Date.now()): boolean {
  const f = failures.get(client);
  return !!f && f.until > now && f.n >= 8;
}
export function recordLoginFailure(client: string, now = Date.now()) {
  const f = failures.get(client);
  failures.set(client, f && f.until > now ? { n: f.n + 1, until: f.until } : { n: 1, until: now + 15 * 60 * 1000 });
}
export function clearLoginFailures(client: string) {
  failures.delete(client);
}
