import { describe, expect, it } from "vitest";
import { authMode, createSession, guard, passwordMatches, SESSION_COOKIE, verifySession, loginBlocked, recordLoginFailure } from "../lib/auth";

const SECRET = "s".repeat(40);
const ON = { OW_PASSWORD: "correct horse battery", OW_SESSION_SECRET: SECRET, NODE_ENV: "production" };

describe("access control", () => {
  it("is closed in production without configuration, never silently open", () => {
    expect(authMode({ NODE_ENV: "production" })).toBe("closed");
    expect(authMode({ NODE_ENV: "production", OW_PASSWORD: "short", OW_SESSION_SECRET: SECRET })).toBe("closed");
    expect(authMode({ NODE_ENV: "development" })).toBe("open");
    expect(authMode(ON)).toBe("on");
  });

  it("accepts a valid session and rejects tampered, expired or foreign ones", async () => {
    const now = 1_800_000_000_000;
    const { token } = await createSession(SECRET, now);
    expect(await verifySession(token, SECRET, now + 1000)).toBe(true);
    expect(await verifySession(token, "x".repeat(40), now + 1000)).toBe(false);
    expect(await verifySession(token.replace(/^\d+/, String(now + 9e12)), SECRET, now)).toBe(false);
    expect(await verifySession(token, SECRET, now + 8 * 24 * 3600 * 1000)).toBe(false);
    expect(await verifySession(undefined, SECRET)).toBe(false);
  });

  it("checks the password and guards route handlers", async () => {
    expect(await passwordMatches("correct horse battery", ON)).toBe(true);
    expect(await passwordMatches("correct horse batter", ON)).toBe(false);
    const { token } = await createSession(SECRET);
    expect(await guard(new Request("http://x/api/productions", { method: "POST" }), ON)).toMatchObject({ status: 401 });
    expect(await guard(new Request("http://x/api/productions", { method: "POST", headers: { cookie: `a=1; ${SESSION_COOKIE}=${token}` } }), ON)).toBeNull();
    expect(await guard(new Request("http://x/"), { NODE_ENV: "production" })).toMatchObject({ status: 503 });
  });

  it("throttles repeated failed logins", () => {
    for (let i = 0; i < 8; i++) recordLoginFailure("1.2.3.4");
    expect(loginBlocked("1.2.3.4")).toBe(true);
    expect(loginBlocked("5.6.7.8")).toBe(false);
  });
});
