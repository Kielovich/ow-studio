import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Loads KEY=value lines from ~/.ow-studio/secrets.env into process.env (existing variables win).
 * The file lives outside the repository and is never committed. Production uses the platform's secret store.
 */
export function loadLocalSecrets(path = join(homedir(), ".ow-studio", "secrets.env")): void {
  let text: string;
  try {
    text = readFileSync(/*turbopackIgnore: true*/ path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
  }
}
