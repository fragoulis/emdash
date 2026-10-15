export const defaultHostSource = `import { createServer } from "node:http";
import { Pool } from "pg";
import { ulid } from "ulidx";
import { runWithContext } from "emdash/request-context";
import { verifiedIdentity } from "./clerk.mjs";

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
process.env.EMDASH_ADMIN_ORIGIN = adminOrigin;
process.env.ASTRO_NODE_AUTOSTART = "disabled";
const { handler } = await import("./dist/server/entry.mjs");
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const setupPage = /^\\/_emdash\\/admin\\/setup(?:\\/|$)/;
const publicApiPath = /^\\/_emdash\\/api\\/(?:media\\/file\\/|search(?:\\/suggest)?$)/;

async function provisionBootstrapUser(identity) {
  const connection = await db.connect();
  try {
    await connection.query("BEGIN");
    const linked = await connection.query(
      "SELECT u.id, u.disabled FROM oauth_accounts a JOIN users u ON u.id = a.user_id WHERE a.provider = 'clerk' AND a.provider_account_id = $1",
      [identity.subject],
    );
    if (linked.rows[0]) {
      if (linked.rows[0].disabled) throw new Error("Bootstrap user is disabled");
      await connection.query("UPDATE users SET email = $1, name = $2, updated_at = $3 WHERE id = $4", [
        identity.email, identity.name, new Date().toISOString(), linked.rows[0].id,
      ]);
    } else {
      const existing = await connection.query("SELECT id FROM users WHERE email = $1", [identity.email]);
      if (existing.rows.length) throw new Error("Clerk email already belongs to another user");
      const id = ulid();
      const now = new Date().toISOString();
      await connection.query(
        "INSERT INTO users (id, email, name, avatar_url, role, email_verified, data, created_at, updated_at) VALUES ($1, $2, $3, NULL, 50, 1, NULL, $4, $4)",
        [id, identity.email, identity.name, now],
      );
      await connection.query(
        "INSERT INTO oauth_accounts (provider, provider_account_id, user_id) VALUES ('clerk', $1, $2)",
        [identity.subject, id],
      );
    }
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}

function hostname(request) {
  const value = request.headers.host;
  if (typeof value !== "string" || !/^[a-z0-9.-]+(?::[0-9]+)?$/.test(value)) return null;
  return value.split(":")[0];
}

async function resolveSite(host) {
  const result = await db.query(
    "SELECT s.id FROM _emdash_site_hosts h JOIN _emdash_sites s ON s.id = h.site_id WHERE h.hostname = $1 AND s.id = 'site-default' AND s.active = 1",
    [host],
  );
  return result.rows[0]?.id ?? null;
}

async function registerDefaultHost() {
  await db.query(
    "INSERT INTO _emdash_site_hosts (hostname, site_id) SELECT $1, id FROM _emdash_sites WHERE id = 'site-default' ON CONFLICT (hostname) DO NOTHING",
    [defaultHost],
  );
}

function serve(request, response, siteId) {
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
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (host === adminHost) {
    if (path === "/_emdash/admin/login" && request.method === "GET") {
      response.writeHead(302, { Location: "/clerk-login", "Cache-Control": "no-store" });
      response.end();
      return;
    }
    if (path === "/clerk-login" && request.method === "GET") {
      serve(request, response);
      return;
    }
    if (path === "/admin" || path === "/admin/") {
      response.writeHead(302, { Location: "/_emdash/admin/setup", "Cache-Control": "no-store" });
      response.end();
      return;
    }
    const setupWrite = path === "/_emdash/api/setup" && request.method === "POST";
    if (!setupWrite && (request.method !== "GET" && request.method !== "HEAD" ||
      !setupPage.test(path) && path !== "/_emdash/api/setup/status" &&
      path !== "/_emdash/api/manifest" && !path.startsWith("/_astro/"))) {
      response.writeHead(403, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    if (setupWrite && (request.headers.origin !== adminOrigin || request.headers["x-emdash-request"] !== "1")) {
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
          response.writeHead(302, { Location: "/_emdash/admin/login", "Cache-Control": "no-store" });
        }
        response.end();
        return;
      }
      if (setupWrite) {
        try {
          await provisionBootstrapUser(identity);
        } catch (error) {
          console.error("[host] Bootstrap user provisioning failed:", error);
          response.writeHead(503, { "Cache-Control": "no-store" });
          response.end();
          return;
        }
      }
    }
    if (setupPage.test(path) || path === "/_emdash/api/setup/status") {
      response.once("finish", () => {
        void registerDefaultHost().catch((error) => console.error("[host] Default host registration failed:", error));
      });
    }
    serve(request, response, "site-default");
    return;
  }
  if (host !== defaultHost || request.method !== "GET" && request.method !== "HEAD" ||
    /^\\/(?:admin|preview)(?:\\/|$)/.test(path) || path === "/clerk-login" ||
    path.startsWith("/_emdash/") && !publicApiPath.test(path)) {
    response.writeHead(421);
    response.end();
    return;
  }
  try {
    const siteId = await resolveSite(host);
    if (!siteId) {
      response.writeHead(421);
      response.end();
      return;
    }
    serve(request, response, siteId);
  } catch (error) {
    console.error("[host] Site lookup failed:", error);
    response.writeHead(503);
    response.end();
  }
});

server.listen(port, "127.0.0.1");
`;
