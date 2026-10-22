export const defaultHostSource = `import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool } from "pg";
import { createDialect } from "emdash/db/postgres";
import { LocalStorage } from "emdash/storage/local";
import { initializeMultisiteDatabase } from "emdash/internal/multisite/initialize";
import { createRegisteredSite, listRegisteredSites, updateRegisteredSiteTitle } from "emdash/internal/multisite/registry";
import { runWithContext } from "emdash/request-context";
import { verifiedIdentity } from "./clerk.mjs";
import { loadPresentations } from "./readiness.mjs";

const adminHost = process.env.EMDASH_ADMIN_HOST ?? "localhost";
const defaultHost = process.env.EMDASH_DEFAULT_HOST ?? "default.localhost";
if (adminHost === defaultHost || !/^[a-z0-9.-]+$/.test(adminHost) || !/^[a-z0-9.-]+$/.test(defaultHost)) {
  throw new Error("Set distinct, valid admin and public hostnames");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const port = Number(process.env.PORT ?? 4321);
if (!process.env.EMDASH_ADMIN_ORIGIN && adminHost !== "localhost") {
  throw new Error("Set EMDASH_ADMIN_ORIGIN for the central admin");
}
const adminOrigin = process.env.EMDASH_ADMIN_ORIGIN ?? "http://localhost:" + port;
const adminUrl = new URL(adminOrigin);
const siteDomain = process.env.EMDASH_SITE_DOMAIN ?? defaultHost.split(".").slice(1).join(".");
if (!/^[a-z0-9.-]+$/.test(siteDomain)) throw new Error("Set a valid EMDASH_SITE_DOMAIN");
process.env.EMDASH_ADMIN_ORIGIN = adminOrigin;
process.env.ASTRO_NODE_AUTOSTART = "disabled";
const require = createRequire(import.meta.url);
const kyselyPath = pathToFileURL(createRequire(require.resolve("emdash/seed")).resolve("kysely")).href;
const { Kysely } = await import(kyselyPath);
const initialSeed = JSON.parse(readFileSync(new URL("./seed/seed.json", import.meta.url), "utf8"));
const seedStorage = new LocalStorage({ directory: fileURLToPath(new URL("./uploads", import.meta.url)), baseUrl: "/_emdash/api/media/file" });
const initializationDb = new Kysely({
  dialect: createDialect({ connectionString: process.env.DATABASE_URL }),
});
try {
  await initializeMultisiteDatabase(initializationDb, initialSeed);
} finally {
  await initializationDb.destroy();
}
const { presentations, getPresentationReadiness } = await loadPresentations(fileURLToPath(new URL("./dist/sites/", import.meta.url)));
if (!presentations.has("default")) throw new Error("Build the default presentation before starting the host");
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const registryDb = new Kysely({ dialect: createDialect({ connectionString: process.env.DATABASE_URL }) });
const publicApiPath = /^\\/_emdash\\/api\\/(?:media\\/file\\/|search(?:\\/suggest)?$)/;
const systemSitesPath = /^\\/_emdash\\/api\\/system\\/sites(?:\\/([a-z][a-z0-9-]*))?$/;
const systemIdentityPath = "/_emdash/api/system/identity";

function json(response, status, body, cacheControl = "no-store") {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheControl });
  response.end(JSON.stringify(body));
}

function apiError(response, status, code, message) {
  json(response, status, { success: false, error: { code, message } });
}

async function readJson(request, maxBytes = 4096) {
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) tooLarge = true;
    else if (!tooLarge) chunks.push(chunk);
  }
  if (tooLarge) throw Object.assign(new Error("too large"), { status: 413 });
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("invalid json"), { status: 400 }); }
}

function encodeSiteCursor(slug, id) {
  return Buffer.from(JSON.stringify([slug, id])).toString("base64url");
}

function decodeSiteCursor(value) {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (Array.isArray(parsed) && parsed.length === 2 && parsed.every((part) => typeof part === "string")) return parsed;
  } catch {}
  return null;
}

async function systemSites(request, response, identity, route) {
  if (!identity?.isSuperAdmin) return apiError(response, 403, "FORBIDDEN", "System administration access required");
  const method = request.method;
  const origin = request.headers.origin;
  if ((method === "PATCH" || method === "POST") && (request.headers["x-emdash-request"] !== "1" || origin !== adminOrigin)) {
    return apiError(response, 403, "CSRF_REJECTED", "Cross-origin request blocked");
  }
  const slug = route[1];
  try {
    if (method === "POST" && !slug) {
      const body = await readJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["title", "slug"].includes(key)) || typeof body.title !== "string" || !body.title.trim() || body.title.length > 120 || typeof body.slug !== "string" || !/^[a-z][a-z0-9-]{0,62}$/.test(body.slug) || ["default", "admin", "localhost"].includes(body.slug)) {
        return apiError(response, 400, "VALIDATION_ERROR", "Invalid site title or slug");
      }
      try {
        const requestKey = request.headers["idempotency-key"];
        if (typeof requestKey !== "string" || !/^[A-Za-z0-9._:-]{16,128}$/.test(requestKey)) return apiError(response, 400, "VALIDATION_ERROR", "A valid Idempotency-Key is required");
        const hostname = body.slug + "." + siteDomain;
        const siteUrl = adminUrl.protocol + "//" + hostname + (adminUrl.port ? ":" + adminUrl.port : "");
        const site = await createRegisteredSite(registryDb, { title: body.title.trim(), slug: body.slug, hostname, siteUrl, actorId: identity.subject, actorScope: identity.subject, actorSource: "system-admin", requestKey, seed: initialSeed, storage: seedStorage });
        return json(response, 201, { success: true, data: { ...site, readiness: getPresentationReadiness(site.presentation) } });
      } catch (error) {
        if (error instanceof Error && /already (registered|used)/.test(error.message)) return apiError(response, 409, "CONFLICT", error.message);
        throw error;
      }
    }
    if (method === "GET" && !slug) {
      const url = new URL(request.url, adminOrigin);
      const rawLimit = url.searchParams.get("limit");
      const parsedLimit = rawLimit === null ? 50 : Number(rawLimit);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1) return apiError(response, 400, "VALIDATION_ERROR", "Invalid limit");
      const limit = Math.min(parsedLimit, 100);
      const cursorValue = url.searchParams.get("cursor");
      const cursor = cursorValue ? decodeSiteCursor(cursorValue) : null;
      if (cursorValue && !cursor) return apiError(response, 400, "VALIDATION_ERROR", "Invalid cursor");
      const all = await listRegisteredSites(registryDb);
      const filtered = cursor ? all.filter((site) => site.slug > cursor[0] || site.slug === cursor[0] && site.id > cursor[1]) : all;
      const page = filtered.slice(0, limit + 1);
      const items = page.slice(0, limit).map((site) => ({ ...site, readiness: getPresentationReadiness(site.presentation) }));
      const last = items.at(-1);
      const nextCursor = page.length > limit && last ? encodeSiteCursor(last.slug, last.id) : undefined;
      return json(response, 200, { success: true, data: { items, ...(nextCursor ? { nextCursor } : {}) } });
    }
    if (method === "GET" && slug) {
      const site = (await listRegisteredSites(registryDb)).find((item) => item.slug === slug);
      if (!site) return apiError(response, 404, "NOT_FOUND", "Site not found");
      return json(response, 200, { success: true, data: { ...site, readiness: getPresentationReadiness(site.presentation) } });
    }
    if (method === "PATCH" && slug) {
      const body = await readJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["title", "expectedRevision"].includes(key)) || typeof body.title !== "string" || !body.title.trim() || body.title.length > 120 || !(body.expectedRevision === null || typeof body.expectedRevision === "string")) {
        return apiError(response, 400, "VALIDATION_ERROR", "Invalid site title update");
      }
      const target = (await listRegisteredSites(registryDb)).find((item) => item.slug === slug);
      if (!target) return apiError(response, 404, "NOT_FOUND", "Site not found");
      const result = await updateRegisteredSiteTitle(registryDb, { siteId: target.id, title: body.title.trim(), expectedRevision: body.expectedRevision, actorId: identity.subject });
      if (!result.ok) return apiError(response, result.reason === "not_found" ? 404 : 409, result.reason === "not_found" ? "NOT_FOUND" : "CONFLICT", result.reason === "not_found" ? "Site not found" : "Site title changed; reload and try again");
      return json(response, 200, { success: true, data: { ...result.value, readiness: getPresentationReadiness(result.value.presentation) } });
    }
    return apiError(response, method === "GET" || method === "PATCH" ? 404 : 405, method === "GET" || method === "PATCH" ? "NOT_FOUND" : "METHOD_NOT_ALLOWED", "System site endpoint not found");
  } catch (error) {
    if (error?.status === 413) return apiError(response, 413, "PAYLOAD_TOO_LARGE", "Request body too large");
    if (error?.status === 400) return apiError(response, 400, "INVALID_JSON", "Request body must be valid JSON");
    console.error("[host] System site request failed:", error);
    return apiError(response, 500, "INTERNAL_ERROR", "System site request failed");
  }
}

function safeLoginDestination(request) {
  const destination = new URL(request.url ?? "/", "http://localhost").searchParams.get("redirect");
  return destination && /^\\/(?:admin|sites|no-access|site\\/[a-z][a-z0-9-]*)$/.test(destination)
    ? destination
    : "/admin";
}

function hostname(request) {
  const value = request.headers.host;
  if (typeof value !== "string" || !/^[a-z0-9.-]+(?::[0-9]+)?$/.test(value)) return null;
  return value.split(":")[0];
}

async function resolveSite(host) {
  const result = await db.query(
    "SELECT s.id, s.slug, COALESCE(s.presentation, s.slug) AS presentation FROM _emdash_site_hosts h JOIN _emdash_sites s ON s.id = h.site_id WHERE h.hostname = $1 AND s.active = 1",
    [host],
  );
  return result.rows[0] ?? null;
}

async function registeredSites() {
  const result = await db.query("SELECT id, slug FROM _emdash_sites ORDER BY slug");
  return result.rows;
}

function serve(request, response, slug, siteId) {
  const handler = presentations.get(slug);
  if (!handler) {
    response.writeHead(503, { "Cache-Control": "no-store" });
    response.end();
    return;
  }
  const context = siteId ? { editMode: false, siteId } : { editMode: false };
  const fail = (error) => {
    console.error("[host] Astro request failed:", error);
    if (!response.headersSent) response.writeHead(500, { "Cache-Control": "no-store" });
    if (!response.writableEnded) response.end();
  };
  try {
    Promise.resolve(runWithContext(context, () => handler(request, response))).catch(fail);
  } catch (error) {
    fail(error);
  }
}

const server = createServer(async (request, response) => {
  const host = hostname(request);
  const proxyToken = process.env.EMDASH_PROXY_TOKEN;
  const forwardedHost = request.headers["x-forwarded-host"];
  const proxyValid = proxyToken
    ? request.headers["x-emdash-proxy-token"] === proxyToken && forwardedHost === request.headers.host
    : forwardedHost === undefined && request.headers["x-emdash-proxy-token"] === undefined;
  if (!host || !proxyValid || request.headers.forwarded || request.headers["x-original-host"]) {
    response.writeHead(421);
    response.end();
    return;
  }
  const rawPath = (request.url ?? "/").split("?")[0];
  if (!rawPath.startsWith("/") || /%2f|%5c|%2e|\\\\/i.test(rawPath) || rawPath.startsWith("//")) {
    response.writeHead(421);
    response.end();
    return;
  }
  let path;
  try {
    path = decodeURI(new URL(request.url ?? "/", "http://localhost").pathname);
  } catch {
    response.writeHead(421);
    response.end();
    return;
  }
  if (host === adminHost) {
    if ((path === "/_emdash/admin/login" || path === "/clerk-login") && request.method === "GET") {
      response.writeHead(302, { Location: "/login", "Cache-Control": "no-store" });
      response.end();
      return;
    }
    if (/^\\/_emdash\\/(?:admin\\/setup(?:\\/|$)|api\\/(?:setup(?:\\/|$)|auth\\/dev-bypass(?:\\/|$)))/.test(path)) {
      response.writeHead(403, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    if (path === "/login" && request.method === "GET") {
      const destination = safeLoginDestination(request);
      const requested = new URL(request.url ?? "/", "http://localhost").searchParams.get("redirect");
      if (requested !== destination) {
        response.writeHead(302, {
          Location: "/login?redirect=" + encodeURIComponent(destination),
          "Cache-Control": "no-store",
        });
        response.end();
        return;
      }
      serve(request, response, "default");
      return;
    }
    if (path.startsWith("/_astro/") && (request.method === "GET" || request.method === "HEAD")) {
      serve(request, response, "default");
      return;
    }
    const landing = path === "/admin" || path === "/admin/" || path === "/_emdash/admin" ||
      path === "/_emdash/admin/";
    const siteSlug = /^\\/site\\/([a-z][a-z0-9-]*)$/.exec(path)?.[1];
    const sitePage = path === "/sites" || siteSlug !== undefined;
    const noAccessPage = path === "/no-access";
    const systemRoute = systemSitesPath.exec(path);
    if (request.method !== "GET" && request.method !== "HEAD" && !(systemRoute && (request.method === "PATCH" || request.method === "POST"))) {
      response.writeHead(403, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    if (!path.startsWith("/_astro/")) {
      let identity;
      try {
        identity = await verifiedIdentity(request.headers.cookie, adminOrigin);
      } catch (error) {
        console.error("[host] Clerk verification failed:", error);
        response.writeHead(503, { "Cache-Control": "no-store" });
        response.end();
        return;
      }
      if (!identity) {
        if (path.startsWith("/_emdash/api/")) {
          response.writeHead(401, { "Cache-Control": "no-store" });
        } else {
          const destination = landing ? "/sites" : noAccessPage ? "/no-access" :
            siteSlug ? "/site/" + siteSlug : path === "/sites" ? "/sites" : "/admin";
          response.writeHead(302, {
            Location: "/login?redirect=" + encodeURIComponent(destination),
            "Cache-Control": "no-store",
          });
        }
        response.end();
        return;
      }
      if (systemRoute) {
        await systemSites(request, response, identity, systemRoute);
        return;
      }
      if (!identity.isSuperAdmin) {
        if (path.startsWith("/_emdash/api/")) {
          response.writeHead(403, { "Cache-Control": "no-store" });
          response.end();
          return;
        }
        if (noAccessPage) {
          serve(request, response, "default");
          return;
        }
        response.writeHead(302, { Location: "/no-access", "Cache-Control": "no-store" });
        response.end();
        return;
      }
      if (path === systemIdentityPath) {
        return json(response, 200, {
          success: true,
          data: { id: identity.subject, name: identity.name, email: identity.email },
        }, "private, no-store");
      }
      if (!landing && !sitePage && !noAccessPage) {
        response.writeHead(403, { "Cache-Control": "no-store" });
        response.end();
        return;
      }
      if (noAccessPage) {
        response.writeHead(302, { Location: "/sites", "Cache-Control": "no-store" });
        response.end();
        return;
      }
      if (landing || sitePage) {
        try {
          if (landing) {
            response.writeHead(302, { Location: "/sites", "Cache-Control": "no-store" });
            response.end();
            return;
          }
          if (noAccessPage || path === "/sites") {
            serve(request, response, "default");
            return;
          }
          if (siteSlug) {
            const sites = await registeredSites();
            const site = sites.find((candidate) => candidate.slug === siteSlug);
            if (!site) {
              response.writeHead(404, { "Cache-Control": "no-store" });
              response.end();
              return;
            }
            serve(request, response, "default");
            return;
          }
          serve(request, response, "default");
          return;
        } catch (error) {
          console.error("[host] Site selection failed:", error);
          response.writeHead(503, { "Cache-Control": "no-store" });
          response.end();
          return;
        }
      }
    }
    response.writeHead(403, { "Cache-Control": "no-store" });
    response.end();
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD" ||
    /^\\/(?:admin|preview|sites?|login|clerk-login|no-access)(?:\\/|$)/.test(path) || path === "/clerk-login" ||
    path.startsWith("/_emdash/") && !publicApiPath.test(path)) {
    response.writeHead(421);
    response.end();
    return;
  }
  try {
    const site = await resolveSite(host);
    if (!site || (host === defaultHost && site.id !== "site-default") ||
      (site.slug === "default") !== (site.id === "site-default")) {
      response.writeHead(421);
      response.end();
      return;
    }
    serve(request, response, site.presentation, site.id);
  } catch (error) {
    console.error("[host] Site lookup failed:", error);
    response.writeHead(503);
    response.end();
  }
});

server.listen(port, "127.0.0.1", async () => {
  const address = server.address();
  if (!address || typeof address === "string") return;
  const origin = (host) => "http://" + host + ":" + address.port;
  console.log("[host] Ready: admin " + origin(adminHost) + "/admin");
  try {
    const result = await db.query(
      "SELECT h.hostname, s.slug, s.presentation FROM _emdash_site_hosts h JOIN _emdash_sites s ON s.id = h.site_id WHERE s.active = 1 ORDER BY h.hostname",
    );
    const hosts = new Set(
      result.rows
        .filter((site) => presentations.has(site.presentation ?? site.slug))
        .map((site) => site.hostname),
    );
    for (const host of hosts) console.log("[host] Public site: " + origin(host));
  } catch (error) {
    console.error("[host] Could not list public site URLs:", error);
  }
});
`;
