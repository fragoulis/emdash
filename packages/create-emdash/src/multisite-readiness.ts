export const readinessSource = `import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function artifactVersion(directory) {
  const hash = createHash("sha256");
  function visit(path, relative) {
    for (const name of readdirSync(path).sort()) {
      if (!relative && name === "version.json") continue;
      const file = join(path, name);
      const key = relative ? relative + "/" + name : name;
      if (statSync(file).isDirectory()) visit(file, key);
      else {
        const name = Buffer.from(key);
        const contents = readFileSync(file);
        const lengths = Buffer.alloc(8);
        lengths.writeUInt32BE(name.length, 0);
        lengths.writeUInt32BE(contents.length, 4);
        hash.update(lengths).update(name).update(contents);
      }
    }
  }
  visit(directory, "");
  return hash.digest("hex");
}

function readLatest(directory) {
  const metadata = JSON.parse(readFileSync(join(directory, "version.json"), "utf8"));
  if (typeof metadata.version !== "string" || !/^[a-f0-9]{64}$/.test(metadata.version)) throw new Error();
  const generation = metadata.generation;
  if (generation !== undefined && (typeof generation !== "string" || !/^[a-f0-9-]{36}$/.test(generation))) throw new Error();
  const artifactDirectory = generation === undefined ? directory : join(directory, "generations", generation);
  if (!existsSync(join(artifactDirectory, "server/entry.mjs"))) throw new Error();
  const actualVersion = artifactVersion(artifactDirectory);
  return { version: actualVersion, generation, artifactDirectory, valid: metadata.version === actualVersion };
}

export async function loadPresentations(root) {
  const presentations = new Map();
  const loadedVersions = new Map();
  const attemptedVersions = new Map();
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
      attemptedVersions.set(entry.name, initial.version);
      const handlerUrl = pathToFileURL(join(initial.artifactDirectory, "server/entry.mjs")).href;
      const { handler } = await import(handlerUrl);
      if (typeof handler !== "function") throw new Error();
      presentations.set(entry.name, handler);
      loadedVersions.set(entry.name, initial.version);
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
        return {
          status: "unavailable",
          loadedVersion: null,
          latestVersion: latest.version,
          pendingRestart: attemptedVersions.get(slug) !== latest.version,
        };
      }
      return { status: "ready", loadedVersion, latestVersion: latest.version, pendingRestart: loadedVersion !== latest.version };
    } catch {
      return { status: "unavailable", loadedVersion, latestVersion: null, pendingRestart: false };
    }
  }
  return { presentations, getPresentationReadiness };
}
`;
