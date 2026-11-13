import { exportDelivery } from "@ow-studio/core";
import { assets, exportName, getImage } from "@/lib/server/repo";

/** One delivery file (2000 x 2000 px sRGB JPEG). ?attempt=n picks an attempt; default the approved one, else the latest. */
export async function GET(req: Request, ctx: RouteContext<"/api/images/[id]/download">) {
  const img = getImage((await ctx.params).id);
  if (!img) return new Response("not found", { status: 404 });
  const want = Number(new URL(req.url).searchParams.get("attempt"));
  const pick = (want ? img.attempts.find((a) => a.attempt === want) : img.attempts.find((a) => a.review === "approved"))
    ?? [...img.attempts].reverse().find((a) => a.finalAsset);
  if (!pick?.finalAsset) return new Response("no image", { status: 404 });
  const out = await exportDelivery((await assets.resolve(pick.finalAsset)).bytes);
  const name = exportName(img.sku, img.preset, img.slotIndex).split("/")[1]!.replace(/\.jpg$/, pick.review === "approved" ? ".jpg" : `_attempt${pick.attempt}.jpg`);
  return new Response(Buffer.from(out.bytes), { headers: { "content-type": "image/jpeg", "content-disposition": `attachment; filename="${name}"` } });
}
