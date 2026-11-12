import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { sha256Hex } from "./canonical.js";
import { imageDimensions } from "./providers/gemini.js";

/**
 * Local content-addressed asset store for development and the provider capability test.
 * Files are stored as <root>/<sha256>.<ext> and never modified. Production uses object storage with the same keys.
 */
export class LocalAssetStore {
  constructor(private readonly root: string) {}

  async put(filePath: string): Promise<string> {
    const bytes = new Uint8Array(await readFile(filePath));
    const dim = imageDimensions(bytes);
    if (!dim) throw new Error(`${filePath} is not a PNG or JPEG`);
    const hex = sha256Hex(bytes);
    await mkdir(this.root, { recursive: true });
    await copyFile(filePath, join(this.root, `${hex}${dim.mime === "image/png" ? ".png" : ".jpg"}`));
    return `sha256:${hex}`;
  }

  async putBytes(bytes: Uint8Array): Promise<string> {
    const dim = imageDimensions(bytes);
    if (!dim) throw new Error("not a PNG or JPEG");
    const hex = sha256Hex(bytes);
    await mkdir(this.root, { recursive: true });
    await writeFile(join(this.root, `${hex}${dim.mime === "image/png" ? ".png" : ".jpg"}`), bytes);
    return `sha256:${hex}`;
  }

  resolve = async (hash: string): Promise<{ bytes: Uint8Array; mime: string }> => {
    const hex = hash.replace(/^sha256:/, "");
    for (const ext of [".png", ".jpg"]) {
      try {
        const bytes = new Uint8Array(await readFile(join(this.root, hex + ext)));
        if (sha256Hex(bytes) !== hex) throw new Error(`asset ${hash} is corrupted`);
        return { bytes, mime: ext === ".png" ? "image/png" : "image/jpeg" };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    throw new Error(`asset ${hash} not found`);
  };
}

export const isImagePath = (p: string) => [".png", ".jpg", ".jpeg"].includes(extname(p).toLowerCase());
