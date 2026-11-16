/**
 * Measurable Human Interface Guidelines checks for a web app, per page, in a real browser:
 *   - touch targets at least 44 x 44 px on a phone (HIG "Buttons", "Layout"), 24 px with a mouse (WCAG 2.2 2.5.8)
 *   - no text under 11 px (HIG "Typography": 11 pt minimum)
 *   - text fields at least 16 px on a phone (smaller makes iOS Safari zoom in on focus)
 *   - text contrast at least 4.5:1, 3:1 for large text (HIG "Accessibility" / "Color", WCAG 1.4.3)
 * Exported for the end-to-end test; run directly against a server for a full report:
 *   node e2e/hig-audit.mjs http://localhost:3100 [path ...]
 */
export async function auditPage(page, { phone }) {
  return page.evaluate(({ phone }) => {
    const out = { targets: [], text: [], inputs: [], contrast: [] };
    const visible = (el) => {
      // Content of a closed <details> is not shown (Chromium still gives it a size).
      const closed = el.closest("details:not([open])");
      if (closed && !el.closest("summary")) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
    };
    const describe = (el) => {
      const t = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""} "${t}"`;
    };
    const disabled = (el) => el.closest("[disabled],[aria-disabled=true],[data-disabled=true]") !== null;

    // Touch targets. A small control inside a larger tappable parent (e.g. an icon in a button) is not a target itself.
    const min = phone ? 44 : 24;
    const interactive = [...document.querySelectorAll("a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=switch],[role=checkbox],[role=link],[role=tab],[role=option]")];
    for (const el of interactive) {
      if (!visible(el) || disabled(el)) continue;
      if (el.matches("input[type=file]") || el.closest("[aria-hidden=true]")) continue;
      // Visually hidden controls for screen readers (react-aria's 1 x 1 px dismiss button) are not touch targets.
      const rr = el.getBoundingClientRect();
      if (rr.width <= 1 && rr.height <= 1) continue;
      const parent = el.parentElement?.closest("a[href],button,[role=button],label");
      if (parent && parent !== el) continue;
      const r = el.getBoundingClientRect();
      if (r.width < min - 0.5 || r.height < min - 0.5) out.targets.push(`${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }

    // Text size and contrast: every element that directly holds visible text.
    const lum = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
    const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
    const backgroundOf = (el) => {
      const layers = [];
      for (let e = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.backgroundImage !== "none" && !s.backgroundImage.startsWith("linear-gradient")) return null; // text on an image: not measurable
        const c = parse(s.backgroundColor);
        if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
      }
      let bg = { r: 255, g: 255, b: 255, a: 1 };
      for (const l of layers.reverse()) bg = over(l, bg);
      return bg;
    };
    const effectiveOpacity = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
    const seenText = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || seenText.has(el) || !visible(el) || el.closest("script,style,noscript,[aria-hidden=true],nextjs-portal")) continue;
      seenText.add(el);
      const s = getComputedStyle(el);
      const size = parseFloat(s.fontSize);
      if (size < 10.95) out.text.push(`${describe(el)} ${size}px`);
      if (disabled(el)) continue;
      const fg = parse(s.color);
      const bg = backgroundOf(el);
      if (!fg || !bg) continue;
      const shown = over({ ...fg, a: fg.a * effectiveOpacity(el) }, bg);
      const L1 = 0.2126 * lum(shown.r) + 0.7152 * lum(shown.g) + 0.0722 * lum(shown.b);
      const L2 = 0.2126 * lum(bg.r) + 0.7152 * lum(bg.g) + 0.0722 * lum(bg.b);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5) - 0.01) out.contrast.push(`${describe(el)} ${ratio.toFixed(2)}:1`);
    }

    if (phone) for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]),select,textarea")) {
      if (!visible(el)) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16) out.inputs.push(`${describe(el)} ${size}px`);
    }
    return out;
  }, { phone });
}

export const auditCount = (a) => a.targets.length + a.text.length + a.inputs.length + a.contrast.length;

// Direct run: full report for a running server.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { createRequire } = await import("node:module");
  const { chromium, devices } = createRequire(import.meta.url)("playwright");
  const base = process.argv[2] ?? "http://localhost:3100";
  const paths = process.argv.slice(3).length ? process.argv.slice(3) : ["/", "/productions", "/productions/new", "/models", "/models/M13", "/settings", "/login"];
  const browser = await chromium.launch();
  let total = 0;
  for (const [label, opts, phone] of [["phone", { ...devices["iPhone 13"] }, true], ["desktop", { viewport: { width: 1440, height: 900 } }, false]]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    for (const path of paths) {
      await page.goto(base + path, { waitUntil: "networkidle" }).catch(() => {});
      await page.waitForTimeout(1500);
      const a = await auditPage(page, { phone });
      total += auditCount(a);
      console.log(`\n[${label}] ${path}: ${auditCount(a)} issue(s)`);
      for (const [k, v] of Object.entries(a)) for (const x of [...new Set(v)].slice(0, 12)) console.log(`  ${k}: ${x}`);
    }
    await ctx.close();
  }
  await browser.close();
  console.log(`\nTOTAL ${total}`);
}
