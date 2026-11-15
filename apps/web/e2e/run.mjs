/**
 * End-to-end test of the main flows in a real browser, against an isolated environment:
 * empty data directory, seeded models, login enabled, worker with the SIMULATED provider (no network, no cost).
 *
 *   npx playwright install --with-deps chromium   (once per machine: the browser for the pinned Playwright devDependency)
 *   npm run e2e -w web            (from the repository root; builds the app and runs it in Chromium)
 *   E2E_SHOTS=dir npm run e2e -w web   also writes screenshots of every page at 1440 and 390 px
 *
 * Fails on any assertion, page error or console error.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { auditCount, auditPage } from "./hig-audit.mjs";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const PORT = Number(process.env.E2E_PORT ?? 3400);
const BASE = `http://localhost:${PORT}`;
const PASSWORD = "e2e-password-123";
const HOME_HEADLINE = "What would you like to make?";
const SHOTS = process.env.E2E_SHOTS;
const data = mkdtempSync(join(tmpdir(), "ow-e2e-data-"));
const fixtures = mkdtempSync(join(tmpdir(), "ow-e2e-fixtures-"));
const env = { ...process.env, OW_DATA_DIR: data, OW_PASSWORD: PASSWORD, OW_SESSION_SECRET: "e".repeat(48), OW_PROVIDER: "simulated", GEMINI_API_KEY: "" };
const procs = [];
let lastPage = null;
const failures = [];
let step = "";

function check(cond, msg) {
  if (!cond) { failures.push(`${step}: ${msg}`); console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`);
}
async function stage(name, fn) { step = name; console.log(`\n${name}`); await fn(); }

async function makeFixtures() {
  const shot = async (shade, w = 900) => sharp({ create: { width: w, height: w, channels: 3, background: { r: 241, g: 241, b: 241 } } })
    .composite([{ input: { create: { width: Math.round(w / 3), height: Math.round(w * 0.7), channels: 3, background: { r: shade, g: shade, b: shade } } }, top: Math.round(w * 0.15), left: Math.round(w / 3) }]).jpeg().toBuffer();
  const files = {
    "Look-07/AB123-045_top-front.jpg": 30, "Look-07/AB123-045_top-back.jpg": 35, "Look-07/SH456-010-shoes.jpg": 20,
    "Look-08/CD789-001_front.jpg": 60, "Look-08/CD789-001_front (1).jpg": 70, "Look-08/CD789-001_back.jpg": 65, "Look-08/IMG_2231.jpg": 80,
  };
  for (const [p, shade] of Object.entries(files)) {
    mkdirSync(join(fixtures, "catalog", p, ".."), { recursive: true });
    await sharp(await shot(shade)).toFile(join(fixtures, "catalog", p));
  }
  // Loose images for a look uploaded by hand (names say nothing about style number or angle).
  mkdirSync(join(fixtures, "manual"), { recursive: true });
  for (const [p, shade] of Object.entries({ "IMG_0101.jpg": 30, "IMG_0102.jpg": 35, "IMG_0103.jpg": 90, "IMG_0104.jpg": 15, "IMG_0105.jpg": 110, "IMG_0106.jpg": 140 })) {
    await sharp(await shot(shade)).toFile(join(fixtures, "manual", p));
  }
}

async function up() {
  const pre = spawnSync(process.execPath, ["--no-warnings", "--import", "tsx", "scripts/prestart.ts"], { env, stdio: "inherit" });
  if (pre.status !== 0) throw new Error("prestart failed");
  const nextBin = require.resolve("next/dist/bin/next");
  // Production build and server: what goes live, and no late hydration from first-time dev compiles.
  if (process.env.E2E_SKIP_BUILD !== "1") {
    const b = spawnSync(process.execPath, [nextBin, "build"], { env: { ...env, NODE_ENV: "production" }, stdio: ["ignore", "ignore", "inherit"] });
    if (b.status !== 0) throw new Error("next build failed");
  }
  procs.push(spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], { env: { ...env, NODE_ENV: "production" }, stdio: ["ignore", "ignore", "inherit"] }));
  procs.push(spawn(process.execPath, ["--no-warnings", "--import", "tsx", "worker/index.ts"], { env, stdio: ["ignore", "ignore", "inherit"] }));
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("server did not start");
}

function watch(page, label) {
  page.on("pageerror", (e) => failures.push(`${label}: page error ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // Expected: 401 before sign-in, and the 404s of the deliberate missing-production and unknown-page checks.
    if (/status of 401/.test(m.text()) || (/status of 404/.test(m.text()) && /prod_missing_|\/this-page-does-not-exist$/.test(m.location()?.url ?? ""))) return;
    failures.push(`${label}: console ${m.text()} (${m.location()?.url ?? ""})`);
  });
}
/** The first dev compile hydrates late: keep typing until the Sign in button reacts. */
async function typeUntilEnabled(page, text) {
  for (let i = 0; i < 60; i++) {
    await page.getByLabel("Password").fill(text);
    if (await page.getByRole("button", { name: "Sign in" }).isEnabled()) return;
    await page.waitForTimeout(1000);
  }
  throw new Error("login form never became interactive");
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
/** Human Interface Guidelines, measured (e2e/hig-audit.mjs): targets, text size, field size, contrast. */
const hig = async (page, label, phone) => {
  const a = await auditPage(page, { phone });
  const first = Object.entries(a).flatMap(([k, v]) => v.map((x) => `${k}: ${x}`)).slice(0, 3).join("; ");
  check(auditCount(a) === 0, `${label} meets the HIG checks${phone ? " on a phone" : ""}${first ? ` (${first})` : ""}`);
};
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); };

async function main() {
  await makeFixtures();
  await up();
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  lastPage = page;
  watch(page, "desktop");

  await stage("Login", async () => {
    await page.goto(`${BASE}/`);
    check(page.url().includes("/login"), "unauthenticated visit redirects to /login");
    check((await page.request.get(`${BASE}/api/overview`)).status() === 401, "API answers 401 without a session");
    await page.getByRole("heading", { name: "Sign in" }).waitFor();
    check(await page.locator("header nav").count() === 0 && await page.locator("header").getByRole("link", { name: "Productions" }).count() === 0,
      "signed out, the header shows only the logo (no menu that leads back to sign-in)");
    await shot(page, "desk-login");
    await typeUntilEnabled(page, "wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText("Wrong password").waitFor();
    check(true, "wrong password is refused with a message");
    await typeUntilEnabled(page, PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${BASE}/`);
    await page.getByRole("heading", { name: HOME_HEADLINE }).waitFor();
    // A calm start: the studio's tools. On-model images opens a new production and shows the models' portraits (never
    // generated images); the three planned tools are marked as coming soon. No review counts.
    const tools = page.getByTestId("tool");
    await tools.first().locator("img").first().waitFor();
    check(await tools.count() === 4
      && await tools.first().getAttribute("href") === "/productions/new"
      && await tools.first().locator("img").count() === 5
      && (await tools.filter({ hasText: "Coming soon" }).count()) === 3
      && await page.locator("main a[href^='/productions/']:not([href='/productions/new'])").count() === 0
      && !(await page.getByText(/to review/i).count()),
      "signed in; the overview offers the tools: on-model images to start, three coming soon, no review counts");
    await shot(page, "desk-overview-empty");
  });

  let draftUrl = "";
  await stage("Folder import with conflicts", async () => {
    await page.goto(`${BASE}/productions/new`);
    await page.getByRole("button", { name: "Choose folder" }).waitFor();
    await page.waitForTimeout(2000); // hydration after the first dev compile
    await page.locator("input[type=file][webkitdirectory]").setInputFiles(join(fixtures, "catalog"));
    // Uploads arrive in chunks: wait for each expected result instead of checking a half-finished upload.
    const appears = async (loc) => { try { await loc.first().waitFor({ timeout: 30000 }); return true; } catch { return false; } };
    await page.getByText("Needs a decision").waitFor({ timeout: 30000 });
    check(await appears(page.getByText("2 files for front")), "two fronts for one SKU are detected");
    check(await appears(page.getByText("Blocks run")), "conflicts block the run");
    check(await appears(page.getByText("Look-07", { exact: true })) && await appears(page.getByText("Look-08", { exact: true })), "folders become sets");
    check(await appears(page.getByTestId("rest-of-look").getByRole("combobox", { name: /SH456-010/ })), "a shoe file in a look folder becomes the look's shoes");
    check(await page.getByTestId("rest-of-look").getByRole("combobox", { name: /SH456-010/ }).inputValue() === "footwear", "it is marked as shoes");
    await page.getByText(/uploading/).waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
    await shot(page, "desk-import-conflicts");
    await page.getByRole("button", { name: "Use this" }).first().click();
    const box = page.locator("div.border-ink");
    await box.getByRole("button", { name: "Ignore" }).click(); // IMG_2231
    await page.waitForTimeout(1200);
    await page.getByText(/Run production · 10 images/).waitFor({ timeout: 30000 });
    check(await page.locator("div.border-ink").count() === 0, "after resolving, nothing blocks; 10 images planned");
    await page.waitForTimeout(1500); // autosave
    draftUrl = page.url();
    check(/draft=draft_/.test(draftUrl), "the import session has its own URL");
  });

  await stage("Import session survives a reload", async () => {
    await page.goto(draftUrl);
    await page.getByText(/Run production · 10 images/).waitFor({ timeout: 30000 });
    check(await page.locator("div.border-ink").count() === 0, "resolved decisions are restored");
    await shot(page, "desk-import-ready");
  });

  let prodUrl = "";
  await stage("Run is idempotent", async () => {
    await page.getByRole("button", { name: /Run production/ }).dblclick();
    await page.waitForURL(/\/productions\/prod_/, { timeout: 30000 });
    prodUrl = page.url();
    const list = await (await page.request.get(`${BASE}/api/productions`)).json();
    check(list.productions.length === 1, "a double click creates exactly one production");
  });

  await stage("Generation (simulated) and review", async () => {
    const id = prodUrl.split("/").pop();
    // The simulated pipeline still runs real background normalisation on 2048 px images: allow up to 8 minutes.
    let states = [];
    for (let i = 0; i < 480; i++) {
      const p = await (await page.request.get(`${BASE}/api/productions/${id}`)).json();
      states = p.images.map((x) => x.state);
      if (states.every((x) => x === "succeeded")) break;
      await page.waitForTimeout(1000);
    }
    check(states.every((x) => x === "succeeded"), `all images succeeded (${states.join(",")})`);
    await page.goto(prodUrl);
    await page.getByText(/0 of 10 approved · 10 finished · 10 to review/).waitFor({ timeout: 30000 });
    check(true, "all 10 images finished; all waiting for review");
    await shot(page, "desk-production-review");
    await page.getByRole("button", { name: "Approve", exact: true }).first().click();
    await page.getByText(/1 of 10 approved/).waitFor();
    check(true, "approve updates the count");
    // Reject a different image than the approved one (approved tiles keep a Reject button).
    await page.getByRole("button", { name: "Reject", exact: true }).nth(1).click();
    await page.getByRole("button", { name: "New attempt (paid)" }).first().waitFor();
    await page.getByRole("button", { name: "New attempt (paid)" }).first().click();
    await page.getByText("2 attempts").first().waitFor({ timeout: 240000 });
    check(true, "a rejected image gets a new attempt; both attempts are kept");
    await page.getByText("2 attempts").first().click();
    await page.getByRole("button", { name: "Compare" }).click();
    await page.getByText("Attempt 1").first().waitFor();
    check(await page.getByText("Attempt 2").first().isVisible(), "lightbox compares attempts side by side");
    await page.waitForTimeout(800);
    await hig(page, "the image viewer", false);
    await page.waitForTimeout(800); // let the open animation finish before the screenshot
    await shot(page, "desk-lightbox-compare");
    await page.keyboard.press("Escape");
  });

  await stage("Downloads", async () => {
    const id = prodUrl.split("/").pop();
    const zip = await page.request.get(`${BASE}/api/productions/${id}/zip`);
    check(zip.status() === 200 && zip.headers()["content-type"] === "application/zip", "approved ZIP downloads");
    const all = await page.request.get(`${BASE}/api/productions/${id}/zip?all=1`);
    check(all.status() === 200 && (await all.body()).length > (await zip.body()).length, "ZIP with all finished images is larger");
    const p = await (await page.request.get(`${BASE}/api/productions/${id}`)).json();
    const one = await page.request.get(`${BASE}/api/images/${p.images[0].id}/download`);
    const meta = await sharp(await one.body()).metadata();
    check(one.status() === 200 && meta.width === 2000 && meta.height === 2000 && meta.format === "jpeg", "single download is a 2000 x 2000 JPEG");
  });

  await stage("Other pages, keyboard and missing production", async () => {
    for (const [path, text] of [["/productions", "Productions"], ["/models", "Models"], ["/settings", "2000 x 2000"], ["/coming-soon", "Lookbook creator"], ["/", HOME_HEADLINE]]) {
      await page.goto(`${BASE}${path}`);
      await page.getByText(text).first().waitFor();
      check(await noOverflow(page), `${path} has no horizontal scroll at 1440 px`);
      await hig(page, path, false);
      await shot(page, `desk${path.replace(/\//g, "-") || "-home"}`);
    }
    // Help: a tip box per page that can be dismissed (and stays dismissed), brought back from Settings, and (i) explanations.
    await page.goto(`${BASE}/`);
    const homeTip = page.getByTestId("tip-home");
    check(await homeTip.waitFor({ timeout: 10000 }).then(() => true, () => false), "the overview shows a how-it-works tip");
    await homeTip.getByRole("button", { name: "Got it" }).click();
    await page.reload();
    await page.getByRole("heading", { name: HOME_HEADLINE }).waitFor();
    await page.waitForTimeout(800);
    check(!(await homeTip.isVisible()), "a dismissed tip stays away after a reload");
    await page.goto(`${BASE}/settings`);
    await page.getByRole("button", { name: "Show all tips again" }).click();
    await page.goto(`${BASE}/`);
    check(await homeTip.waitFor({ timeout: 10000 }).then(() => true, () => false), "Settings brings dismissed tips back");
    await page.goto(`${BASE}/productions/new`);
    // One step at a time: the shots are in step 2, reached from the bottom bar.
    await page.getByRole("button", { name: "Next: Model & shots" }).click();
    check(await page.getByRole("heading", { name: "Model" }).isVisible() && !(await page.getByRole("heading", { name: "Packshots" }).isVisible()), "the new production page shows one step at a time");
    await page.getByRole("button", { name: "About: One studio session" }).click();
    check(await page.getByRole("dialog").getByText(/front image is made first/).waitFor({ timeout: 5000 }).then(() => true, () => false), "an (i) button opens its explanation");
    await page.keyboard.press("Escape");

    // Coming soon: the three planned tools, reachable from the overview.
    await page.goto(`${BASE}/coming-soon`);
    await page.getByTestId("coming-soon-item").first().waitFor();
    check(await page.getByTestId("coming-soon-item").count() === 3 && await page.getByText("Packshot generator").first().isVisible() && await page.getByText("Campaign shoot").first().isVisible(), "the coming-soon page lists packshot generator, lookbook creator and campaign shoot");

    // Model library: an overview of portraits and names; each model opens on all her reference images.
    await page.goto(`${BASE}/models`);
    await page.getByTestId("model-card").first().waitFor();
    check(await page.getByTestId("model-card").count() === 6, "models page shows one card per model (6)");
    await page.getByTestId("model-card").filter({ hasText: "Sable" }).click();
    await page.getByText("← All models").waitFor();
    check(await page.getByRole("button", { name: /Identity portrait|Body, front|Character sheet/ }).count() >= 3, "a model page shows her reference images");
    await page.getByRole("button", { name: /Body, front/ }).first().click();
    check(await page.getByRole("dialog").getByRole("img").first().waitFor({ timeout: 10000 }).then(() => true, () => false), "a reference image opens large");
    await page.keyboard.press("Escape");
    check(await noOverflow(page), "/models/M01 has no horizontal scroll at 1440 px");
    await page.keyboard.press("Tab");
    const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    check(ring !== "none", "keyboard focus is visible");
    await page.goto(`${BASE}/productions/prod_missing_000000`);
    await page.getByText("Not found").waitFor({ timeout: 15000 });
    check(true, "a missing production shows a clear not-found state");
  });

  await stage("A look uploaded by hand", async () => {
    // Only the garment packshots are required: shoes, accessories and a fit reference are optional.
    await page.goto(`${BASE}/productions/new`);
    await page.getByRole("button", { name: "Add a look by hand" }).click();
    await page.getByTestId("manual-look").getByRole("textbox", { name: "Look name" }).fill("Manual-00");
    await page.getByTestId("slot-top-front").locator("xpath=..").locator("input[type=file]").setInputFiles(join(fixtures, "manual", "IMG_0101.jpg"));
    await page.getByTestId("slot-top-back").locator("xpath=..").locator("input[type=file]").setInputFiles(join(fixtures, "manual", "IMG_0102.jpg"));
    const minimal = page.waitForResponse(async (r) => r.url().endsWith("/api/compile") && (await r.json().catch(() => null))?.images?.length === 5, { timeout: 60000 });
    await page.getByTestId("manual-look").getByRole("button", { name: "Add look" }).click();
    const min = await (await minimal).json();
    check(min.canRun === true && min.images.every((i) => !i.refs.some((r) => ["footwear", "accessory", "fit_reference", "look_garment_front"].includes(r))), `a look with only a top can run; shoes, accessories and fit are optional (${min.canRun}, ${min.conflicts.filter((c) => c.severity === "error").map((c) => c.code).join(",")})`);
    check(await page.getByTestId("rest-of-look").count() === 0, "no empty 'rest of the look' for a look without extras");

    await page.goto(`${BASE}/productions/new`); // a fresh import (no ?draft=)
    await page.getByRole("button", { name: "Add a look by hand" }).click();
    const panel = page.getByTestId("manual-look");
    await panel.getByRole("textbox", { name: "Look name" }).fill("Manual-01");
    const put = (slot, file) => page.getByTestId(slot).locator("xpath=..").locator("input[type=file]").setInputFiles(join(fixtures, "manual", file));
    await put("slot-top-front", "IMG_0101.jpg");
    await put("slot-top-back", "IMG_0102.jpg");
    await put("slot-bottom-front", "IMG_0103.jpg");
    await put("slot-shoes", "IMG_0104.jpg");
    await put("slot-accessory-0", "IMG_0105.jpg");
    await put("slot-fit", "IMG_0106.jpg");
    check(await page.getByRole("img", { name: "Fit" }).isVisible(), "a chosen image shows in its slot before upload");
    const compiled = page.waitForResponse(async (r) => r.url().endsWith("/api/compile") && (await r.json().catch(() => null))?.images?.length === 10, { timeout: 60000 });
    await panel.getByRole("button", { name: "Add look" }).click();
    await page.getByText("Manual-01", { exact: true }).waitFor({ timeout: 30000 });
    check(await page.getByText("Manual-01-TOP").first().isVisible() && await page.getByText("Manual-01-BOTTOM").first().isVisible(), "a look added by hand becomes a top and a bottom product");
    const rest = page.getByTestId("rest-of-look");
    await rest.locator("select").nth(2).waitFor({ timeout: 30000 });
    const kinds = (await rest.locator("select").evaluateAll((els) => els.map((e) => e.value))).sort();
    check(JSON.stringify(kinds) === JSON.stringify(["accessory", "fit", "footwear"]), `shoes, accessory and fit reference belong to the look (${kinds})`);
    const preview = await (await compiled).json();
    const roles = (sku, preset) => preview.images.find((i) => i.sku === sku && i.preset === preset)?.refs ?? [];
    check(roles("Manual-01-BOTTOM", "full_body").includes("look_garment_front") && roles("Manual-01-BOTTOM", "full_body").includes("footwear") && roles("Manual-01-BOTTOM", "full_body").includes("fit_reference"),
      `the trousers are shot with the top, the shoes and the fit reference (${roles("Manual-01-BOTTOM", "full_body")})`);
    check(roles("Manual-01-TOP", "styled_full").includes("accessory"), "the accessory is used in the styled shot");
    check(!roles("Manual-01-TOP", "detail").some((r) => ["look_garment_front", "footwear", "accessory", "fit_reference"].includes(r)), "the close-up stays on the product alone");
    await shot(page, "desk-manual-look");
  });

  await stage("Mobile (iPhone 13, 390 px)", async () => {
    const m = await browser.newContext({ ...devices["iPhone 13"], storageState: await ctx.storageState() });
    const mp = await m.newPage();
    watch(mp, "mobile");
    for (const path of ["/", "/productions", prodUrl.replace(BASE, ""), "/productions/new", "/models", "/models/M01", "/coming-soon", "/settings"]) {
      await mp.goto(`${BASE}${path}`);
      await mp.waitForTimeout(2500);
      check(await noOverflow(mp), `${path} has no horizontal scroll at 390 px`);
      await hig(mp, path, true);
      await shot(mp, `mob${path.replace(/\//g, "-").slice(0, 40) || "-home"}`);
    }
    await mp.goto(`${BASE}/productions/new`);
    await mp.getByRole("button", { name: "Add a look by hand" }).click();
    await mp.getByTestId("manual-look").waitFor();
    check(await mp.getByTestId("look-optional").getByText("Optional · complete the look").isVisible(), "shoes, accessories and fit are marked optional");
    await hig(mp, "the manual look panel", true);
    check(await noOverflow(mp), "the manual look panel has no horizontal scroll at 390 px");
    // Mobile navigation is one compact Menu button; the menu holds every page and log out.
    check(!(await mp.getByRole("link", { name: "Productions", exact: true }).isVisible()), "mobile header is compact (links behind the menu)");
    await mp.getByRole("button", { name: "Menu" }).click();
    check(await mp.getByRole("button", { name: "Log out" }).isVisible(), "log out is reachable on mobile");
    await hig(mp, "the open mobile menu", true);
    // Screenshots last on this page: a full-page screenshot resets Playwright's touch emulation for later checks.
    await mp.keyboard.press("Escape");
    await mp.getByTestId("manual-look").scrollIntoViewIfNeeded();
    await shot(mp, "mob-manual-look");
    await mp.getByRole("button", { name: "Menu" }).click();
    await mp.getByRole("link", { name: "Models", exact: true }).click();
    await mp.waitForURL(/\/models$/);
    check(await mp.locator("#mobile-menu").waitFor({ state: "hidden", timeout: 5000 }).then(() => true, () => false), "the mobile menu closes after navigating");
    await m.close();
  });

  await stage("Health check and backup", async () => {
    const h = await fetch(`${BASE}/api/health`);
    check(h.ok && (await h.json()).ok === true, "health check answers without a session");
    const backups = readdirSync(join(data, "backups"));
    check(backups.some((f) => /^studio-\d{4}-\d{2}-\d{2}\.db$/.test(f)), "the worker wrote today's database backup");
  });

  await stage("Launch details: icons, titles, 404, robots and headers", async () => {
    // Without a session (plain fetch, no cookies): the sign-in page needs its icons too.
    const fav = await fetch(`${BASE}/favicon.ico`);
    const favHash = (await import("node:crypto")).createHash("md5").update(Buffer.from(await fav.arrayBuffer())).digest("hex");
    check(fav.ok && favHash !== "2be26fb5639bc7a24d9c816567b0de5f", "the favicon loads without a session and is the OW mark, not the framework default");
    const touch = await fetch(`${BASE}/apple-icon.png`);
    check(touch.ok && (touch.headers.get("content-type") ?? "").includes("image/png"), "the home-screen icon loads without a session");
    const robots = await fetch(`${BASE}/robots.txt`);
    check(robots.ok && (await robots.text()).includes("Disallow: /"), "robots.txt keeps the whole site out of search engines");
    const login = await fetch(`${BASE}/login`);
    const html = await login.text();
    check(login.headers.get("x-frame-options") === "DENY" && login.headers.get("x-content-type-options") === "nosniff" && /noindex/.test(html),
      "pages send security headers and a noindex tag");
    // Titles: one per page, the production's own name on a production.
    await page.goto(`${BASE}/models`);
    await page.getByTestId("model-card").first().waitFor();
    check(await page.title() === "Models · OW Studio", "each page has its own title (Models · OW Studio)");
    await page.goto(`${BASE}/productions`);
    const first = page.locator("main a[href^='/productions/prod_']").first();
    await first.waitFor();
    await first.click();
    await page.waitForFunction(() => document.title !== "Production · OW Studio" && document.title.endsWith(" · OW Studio"), null, { timeout: 10000 });
    check(await page.title() === `${(await page.getByRole("heading", { level: 1 }).textContent())?.trim()} · OW Studio`, "a production's tab shows its name");
    // A branded 404 with a way back.
    const r404 = await page.goto(`${BASE}/this-page-does-not-exist`);
    check(r404?.status() === 404 && await page.getByRole("heading", { name: "This page does not exist" }).isVisible()
      && await page.getByRole("link", { name: "Back to the studio" }).isVisible(), "an unknown address shows the studio's own 404 with a way back");
    await hig(page, "/404", false);
  });

  await stage("Logout", async () => {
    await page.goto(`${BASE}/`);
    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL(/\/login/);
    await page.goto(`${BASE}/settings`);
    check(page.url().includes("/login"), "after logout pages need a new sign-in");
  });

  await browser.close();
}

main()
  .catch(async (e) => {
    failures.push(`${step}: ${e.message.split("\n")[0]}`);
    if (lastPage) await lastPage.screenshot({ path: join(SHOTS ?? tmpdir(), "e2e-failure.png") }).catch(() => {});
  })
  .finally(() => {
    for (const p of procs) p.kill("SIGTERM");
    rmSync(data, { recursive: true, force: true });
    rmSync(fixtures, { recursive: true, force: true });
    if (failures.length) { console.error(`\nE2E FAILED (${failures.length}):\n- ${failures.join("\n- ")}`); process.exit(1); }
    console.log("\nE2E passed");
    process.exit(0);
  });
