import { fileURLToPath } from "node:url";

import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";

const site = process.env.PROOF_SITE;
if (!/^(foo|bar|admin)$/.test(site ?? "")) throw new Error("Set PROOF_SITE to foo, bar or admin");

export default defineConfig({
	output: "server",
	adapter: node({ mode: "standalone" }),
	outDir: `./dist/${site}`,
	srcDir: fileURLToPath(new URL(`./src/${site}/`, import.meta.url)),
	publicDir: fileURLToPath(new URL(`./src/${site}/public/`, import.meta.url)),
	integrations:
		site === "admin"
			? [
					react(),
					{
						name: "admin-route",
						hooks: {
							"astro:config:setup"({ injectRoute }) {
								injectRoute({
									pattern: "/_emdash/admin/[...path]",
									entrypoint: fileURLToPath(
										new URL("./src/admin/routes/admin.astro", import.meta.url),
									),
								});
							},
						},
					},
				]
			: [],
});
