export const buildSource = `import { readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const sites = readdirSync(new URL("./src/", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "default")
  .map((entry) => entry.name).sort();
if (!existsSync(new URL("./src/default/", import.meta.url)) ||
  sites.some((slug) => !/^[a-z][a-z0-9-]*$/.test(slug))) {
  throw new Error("Invalid site presentation directory");
}
for (const slug of ["default", ...sites]) {
  const result = spawnSync(process.execPath, [join("node_modules", "astro", "bin", "astro.mjs"), "build"], {
    stdio: "inherit",
    env: { ...process.env, EMDASH_BUILD_SITE: slug },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
`;
