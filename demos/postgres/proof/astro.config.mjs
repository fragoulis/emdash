import node from "@astrojs/node";
import { defineConfig } from "astro/config";

const site = process.env.PROOF_SITE;
if (!/^(foo|bar)$/.test(site ?? "")) throw new Error("Set PROOF_SITE to foo or bar");

export default defineConfig({
	output: "server",
	adapter: node({ mode: "standalone" }),
	outDir: `./dist/${site}`,
});
