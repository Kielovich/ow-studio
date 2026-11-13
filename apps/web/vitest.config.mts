import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  // Pipeline tests normalise real 2K images through sharp; allow them time.
  test: { include: ["test/**/*.test.ts"], testTimeout: 60_000 },
});
