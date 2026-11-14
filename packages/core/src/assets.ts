import { randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { sha256Hex } from "./canonical";
import { imageDimensions } from "./providers/gemini";

/**
 * Local content-addressed asset store for development and the provider capability test.
 * Files are stored as <root>/<sha256>.<ext> and never modified. Production uses object storage with the same keys.
 *
 * Writes are atomic (temporary file, then rename) and an existing intact file is left alone. Writing in place let a
 * reader in another worker see a half-written file when two workers stored the same asset (a shared crop or session
 * anchor) at once: "asset ... is corrupted", the job crashed mid-submission.
 */
export class LocalAssetStore {
  constructor(private readonly root: string) {}

  private async store(hex: string, ext: string, write: (tmp: string) => Promise<void>): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const file = join(this.root, hex + ext);
    try {
      if (sha256Hex(new Uint8Array(await readFile(file))) === hex) return; // already stored and intact
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const tmp = join(this.root, `.${hex}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    try {
      await write(tmp);
      await rename(tmp, file); // atomic on one filesystem: readers see the old file, no file, or the whole new one
    } finally {
      await rm(tmp, { force: true });
    }
  }

  async put(filePath: string): Promise<string> {
    const bytes = new Uint8Array(await readFile(filePath));
    const dim = imageDimensions(bytes);
    if (!dim) throw new Error(`${filePath} is not a PNG or JPEG`);
    const hex = sha256Hex(bytes);
    await this.store(hex, dim.mime === "image/png" ? ".png" : ".jpg", (tmp) => copyFile(filePath, tmp));
    return `sha256:${hex}`;
  }

  async putBytes(bytes: Uint8Array): Promise<string> {
    const dim = imageDimensions(bytes);
    if (!dim) throw new Error("not a PNG or JPEG");
    const hex = sha256Hex(bytes);
    await this.store(hex, dim.mime === "image/png" ? ".png" : ".jpg", (tmp) => writeFile(tmp, bytes));
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
