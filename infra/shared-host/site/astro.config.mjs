import { fileURLToPath } from "node:url";

import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";

const site = process.env.PROOF_SITE;
if (!/^(foo|bar|platform)$/.test(site ?? ""))
	throw new Error("Set PROOF_SITE to foo, bar or platform");

export default defineConfig({
	output: "server",
	adapter: node({ mode: "standalone" }),
	outDir: `./dist/${site}`,
	srcDir: fileURLToPath(
		new URL(site === "platform" ? "./platform/src/" : "./src/", import.meta.url),
	),
	integrations:
		site === "platform"
			? [
					react(),
					{
						name: "platform-admin-route",
						hooks: {
							"astro:config:setup"({ injectRoute }) {
								injectRoute({
									pattern: "/_emdash/admin/[...path]",
									entrypoint: fileURLToPath(
										new URL("./platform/src/routes/admin.astro", import.meta.url),
									),
								});
							},
						},
					},
				]
			: [],
});
