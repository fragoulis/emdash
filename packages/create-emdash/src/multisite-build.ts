export const buildSource = `import { readdirSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { artifactVersion } from "./readiness.mjs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const sites = readdirSync(new URL("./src/", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "default")
  .map((entry) => entry.name).sort();
if (!existsSync(new URL("./src/default/", import.meta.url)) ||
  sites.some((slug) => !/^[a-z][a-z0-9-]*$/.test(slug))) {
  throw new Error("Invalid site presentation directory");
}
for (const slug of ["default", ...sites]) {
  const siteRoot = fileURLToPath(new URL("./dist/sites/" + slug + "/", import.meta.url));
  const generations = join(siteRoot, "generations");
  mkdirSync(generations, { recursive: true });
  const generation = randomUUID();
  const output = join(generations, generation);
  mkdirSync(output);
  try {
    const result = spawnSync(process.execPath, [join("node_modules", "astro", "bin", "astro.mjs"), "build"], {
      stdio: "inherit",
      env: { ...process.env, EMDASH_BUILD_SITE: slug, EMDASH_BUILD_OUTPUT: output },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error("Astro build failed for " + slug);
    const version = artifactVersion(output);
    const temporaryPath = join(siteRoot, "version.json.tmp-" + randomUUID());
    writeFileSync(temporaryPath, JSON.stringify({ version, generation }) + "\\n");
    renameSync(temporaryPath, join(siteRoot, "version.json"));
  } catch (error) {
    rmSync(output, { recursive: true, force: true });
    throw error;
  }
}
`;
