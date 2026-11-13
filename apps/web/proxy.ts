import { NextResponse, type NextRequest } from "next/server";
import { authMode, SESSION_COOKIE, verifySession } from "@/lib/auth";

/** Paths reachable without a session: the login page and its API, and the health check for the platform. */
const PUBLIC = ["/login", "/api/auth/login", "/api/health"];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.includes(pathname)) return NextResponse.next();
  const mode = authMode();
  if (mode === "open") return NextResponse.next();
  const api = pathname.startsWith("/api/");
  if (mode === "closed") {
    return api
      ? NextResponse.json({ error: "Not configured: set OW_PASSWORD and OW_SESSION_SECRET" }, { status: 503 })
      : new NextResponse("OW Studio is not configured: set OW_PASSWORD (12+ characters) and OW_SESSION_SECRET (32+ characters).", { status: 503 });
  }
  if (await verifySession(req.cookies.get(SESSION_COOKIE)?.value, process.env.OW_SESSION_SECRET!)) return NextResponse.next();
  if (api) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const url = new URL("/login", req.url);
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except build assets and public brand files (logo, fonts, favicon).
  matcher: ["/((?!_next/static|_next/image|brand/|fonts/|favicon.ico).*)"],
};
