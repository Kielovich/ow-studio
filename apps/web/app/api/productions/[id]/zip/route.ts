import { strToU8, zipSync } from "fflate";
import { exportDelivery } from "@ow-studio/core";
import { assets, getProduction, zipEntries, zipManifest } from "@/lib/server/repo";

/**
 * ZIP of delivery files (2000 x 2000 px sRGB JPEG, see exportDelivery) named SKU/SKU_NN_preset.jpg in gallery order, plus manifest.csv saying which attempt each file is and whether it
 * was approved. Default: approved images only. ?all=1 adds finished images that are not approved (latest attempt).
 */
export async function GET(req: Request, ctx: RouteContext<"/api/productions/[id]/zip">) {
  const id = (await ctx.params).id;
  const p = getProduction(id);
  if (!p) return new Response("not found", { status: 404 });
  const all = new URL(req.url).searchParams.get("all") === "1";
  const entries = zipEntries(id, { all });
  if (!entries.length) return new Response(all ? "no finished images" : "no approved images", { status: 404 });
  const files: Record<string, Uint8Array> = { "manifest.csv": strToU8(zipManifest(entries)) };
  for (const e of entries) files[e.name] = (await exportDelivery((await assets.resolve(e.asset)).bytes)).bytes;
  const zip = zipSync(files, { level: 0 });
  return new Response(Buffer.from(zip), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${p.id}${all ? "_all" : "_approved"}.zip"` },
  });
}
