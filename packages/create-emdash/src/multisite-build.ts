export const buildSource = `import { createHash } from "node:crypto";
import { readdirSync, existsSync, readFileSync, writeFileSync, renameSync, statSync } from "node:fs";
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
  const hash = createHash("sha256");
  function visit(directory, relative) {
    for (const name of readdirSync(directory).sort()) {
      if (!relative && name === "version.json") continue;
      const path = join(directory, name);
      const key = relative ? relative + "/" + name : name;
      if (statSync(path).isDirectory()) visit(path, key);
      else {
        hash.update(key);
        hash.update(readFileSync(path));
      }
    }
  }
  visit(output, "");
  const version = hash.digest("hex");
  const metadataPath = new URL("./dist/sites/" + slug + "/version.json", import.meta.url);
  const temporaryPath = new URL("./dist/sites/" + slug + "/version.json.tmp", import.meta.url);
  writeFileSync(temporaryPath, JSON.stringify({ version }) + "\\n");
  renameSync(temporaryPath, metadataPath);
}
`;
