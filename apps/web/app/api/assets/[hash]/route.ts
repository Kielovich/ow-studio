import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { DATA_DIR } from "@/lib/server/db";
import { assets } from "@/lib/server/repo";

const WIDTHS = new Set([240, 480, 800, 1200]);

/** Content-addressed asset delivery. ?w= gives a cached WebP thumbnail; without it, the original. */
export async function GET(req: Request, ctx: RouteContext<"/api/assets/[hash]">) {
  const { hash } = await ctx.params;
  if (!/^[0-9a-f]{64}$/.test(hash)) return new Response("bad hash", { status: 400 });
  const w = Number(new URL(req.url).searchParams.get("w"));
  const headers = { "cache-control": "public, max-age=31536000, immutable" };
  let original: { bytes: Uint8Array; mime: string };
  try {
    original = await assets.resolve(`sha256:${hash}`);
  } catch {
    return new Response("not found", { status: 404 });
  }
  if (!WIDTHS.has(w)) return new Response(Buffer.from(original.bytes), { headers: { ...headers, "content-type": original.mime } });
  const dir = join(DATA_DIR, "thumbs");
  const file = join(dir, `${hash}_${w}.webp`);
  if (!existsSync(file)) {
    await mkdir(dir, { recursive: true });
    await writeFile(file, await sharp(original.bytes).resize({ width: w, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer());
  }
  return new Response(await readFile(file), { headers: { ...headers, "content-type": "image/webp" } });
}
