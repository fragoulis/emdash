import { mkdirSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");

export function linkScaffoldDependencies(project: string): void {
	const dependencies = resolve(project, "node_modules");
	mkdirSync(dependencies);
	const templateDependencies = resolve(root, "templates/blog/node_modules");
	for (const name of ["astro", "@astrojs", "emdash", "react", "react-dom"]) {
		symlinkSync(resolve(templateDependencies, name), resolve(dependencies, name), "dir");
	}
	for (const name of ["pg", "ulidx"]) {
		symlinkSync(
			resolve(root, "node_modules/.pnpm/node_modules", name),
			resolve(dependencies, name),
			"dir",
		);
	}
	const clerkDependencies = resolve(dependencies, "@clerk");
	mkdirSync(clerkDependencies);
	for (const name of ["backend", "shared", "clerk-js"]) {
		symlinkSync(
			resolve(root, "packages/create-emdash/node_modules/@clerk", name),
			resolve(clerkDependencies, name),
			"dir",
		);
	}
	for (const [scope, name] of [
		["@cloudflare", "kumo"],
		["@emdash-cms", "admin"],
	]) {
		const directory = resolve(dependencies, scope);
		mkdirSync(directory);
		symlinkSync(
			resolve(root, "node_modules/.pnpm/node_modules", scope, name),
			resolve(directory, name),
			"dir",
		);
	}
}
