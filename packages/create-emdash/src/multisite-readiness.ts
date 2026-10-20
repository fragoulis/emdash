export const readinessSource = `import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function artifactVersion(directory) {
  const hash = createHash("sha256");
  function visit(path, relative) {
    for (const name of readdirSync(path).sort()) {
      if (!relative && name === "version.json") continue;
      const file = join(path, name);
      const key = relative ? relative + "/" + name : name;
      if (statSync(file).isDirectory()) visit(file, key);
      else {
        hash.update(key);
        hash.update(readFileSync(file));
      }
    }
  }
  visit(directory, "");
  return hash.digest("hex");
}

function readLatest(directory) {
  const metadata = JSON.parse(readFileSync(join(directory, "version.json"), "utf8"));
  if (typeof metadata.version !== "string" || !/^[a-f0-9]{64}$/.test(metadata.version)) throw new Error();
  const actualVersion = artifactVersion(directory);
  return { version: actualVersion, valid: metadata.version === actualVersion };
}

export async function loadPresentations(root) {
  const presentations = new Map();
  const loadedVersions = new Map();
  let entries = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {}
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-z][a-z0-9-]*$/.test(entry.name)) continue;
    const directory = join(root, entry.name);
    try {
      const initial = readLatest(directory);
      if (!initial.valid) throw new Error();
      const handlerUrl = pathToFileURL(join(directory, "server/entry.mjs")).href;
      const { handler } = await import(handlerUrl);
      if (typeof handler !== "function") throw new Error();
      const afterImport = readLatest(directory);
      if (!afterImport.valid || afterImport.version !== initial.version) throw new Error();
      presentations.set(entry.name, handler);
      loadedVersions.set(entry.name, afterImport.version);
    } catch {}
  }
  function getPresentationReadiness(slug) {
    if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
      return { status: "unavailable", loadedVersion: null, latestVersion: null, pendingRestart: false };
    }
    const loadedVersion = loadedVersions.get(slug) ?? null;
    try {
      const latest = readLatest(join(root, slug));
      if (!latest.valid) return { status: "unavailable", loadedVersion, latestVersion: null, pendingRestart: false };
      if (!loadedVersion || !presentations.has(slug)) {
        return { status: "unavailable", loadedVersion: null, latestVersion: latest.version, pendingRestart: true };
      }
      return { status: "ready", loadedVersion, latestVersion: latest.version, pendingRestart: loadedVersion !== latest.version };
    } catch {
      return { status: "unavailable", loadedVersion, latestVersion: null, pendingRestart: false };
    }
  }
  return { presentations, getPresentationReadiness };
}
`;
