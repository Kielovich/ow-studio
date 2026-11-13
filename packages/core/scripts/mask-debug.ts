/** Writes the background mask of an image as PNG: npx tsx scripts/mask-debug.ts <in.jpg> <out.png> */
import sharp from "sharp";
import { normalizeBackgroundRaw } from "../src/post/background.js";
const f = process.argv[2]!;
const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const r = normalizeBackgroundRaw(new Uint8Array(data), info.width, info.height);
await sharp(Buffer.from(r.mask!), { raw: { width: info.width, height: info.height, channels: 1 } }).resize(600).png().toFile(process.argv[3]!);
