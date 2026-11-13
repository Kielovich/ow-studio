import { imageDimensions } from "@ow-studio/core";
import { parseName } from "@/lib/filename";
import { assets } from "@/lib/server/repo";

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request) {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const results = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) { results.push({ filename: f.name, error: "File is larger than 25 MB" }); continue; }
    let bytes = new Uint8Array(await f.arrayBuffer());
    // WebP and other formats are converted to PNG; only PNG and JPEG are stored.
    if (!imageDimensions(bytes)) {
      try {
        const sharp = (await import("sharp")).default;
        bytes = new Uint8Array(await sharp(bytes).png().toBuffer());
      } catch {
        results.push({ filename: f.name, error: "Not a readable image" });
        continue;
      }
    }
    const dim = imageDimensions(bytes)!;
    const hash = await assets.putBytes(bytes);
    results.push({ filename: f.name, hash, width: dim.width, height: dim.height, ...parseName(f.name) });
  }
  return Response.json({ files: results });
}
