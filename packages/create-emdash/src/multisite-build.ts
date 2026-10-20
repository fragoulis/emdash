export const buildSource = `import { readdirSync, existsSync, writeFileSync, renameSync } from "node:fs";
import { artifactVersion } from "./readiness.mjs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
  const output = fileURLToPath(new URL("./dist/sites/" + slug + "/", import.meta.url));
  const version = artifactVersion(output);
  const metadataPath = new URL("./dist/sites/" + slug + "/version.json", import.meta.url);
  const temporaryPath = new URL("./dist/sites/" + slug + "/version.json.tmp", import.meta.url);
  writeFileSync(temporaryPath, JSON.stringify({ version }) + "\\n");
  renameSync(temporaryPath, metadataPath);
}
`;
