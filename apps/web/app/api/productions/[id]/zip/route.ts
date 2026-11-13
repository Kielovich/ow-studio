import { zipSync } from "fflate";
import { OW_SET } from "@ow-studio/core";
import { assets, getProduction } from "@/lib/server/repo";

/** ZIP of all final images, named SKU_NN_preset.jpg in gallery order. */
export async function GET(_: Request, ctx: RouteContext<"/api/productions/[id]/zip">) {
  const p = getProduction((await ctx.params).id);
  if (!p) return new Response("not found", { status: 404 });
  const files: Record<string, Uint8Array> = {};
  for (const img of p.images) {
    if (!img.finalAsset) continue;
    const order = OW_SET.indexOf(img.preset);
    const n = String((order >= 0 ? order : img.slotIndex) + 1).padStart(2, "0");
    files[`${img.sku}/${img.sku}_${n}_${img.preset}.jpg`] = (await assets.resolve(img.finalAsset)).bytes;
  }
  if (!Object.keys(files).length) return new Response("no finished images", { status: 404 });
  const zip = zipSync(files, { level: 0 });
  return new Response(Buffer.from(zip), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${p.id}.zip"` },
  });
}
