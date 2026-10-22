import { readFileSync } from "node:fs";
// Replaced by tsdown so the published CLI does not need monorepo metadata.
declare const __EMDASH_ADMIN_DEPENDENCY_RANGE__: string | undefined;

export function getAdminDependencyRange(): string {
	if (typeof __EMDASH_ADMIN_DEPENDENCY_RANGE__ !== "undefined") {
		return __EMDASH_ADMIN_DEPENDENCY_RANGE__;
	}

	const manifestUrl = new URL("../../admin/package.json", import.meta.url);
	const manifest: unknown = JSON.parse(readFileSync(manifestUrl, "utf8"));
	const version =
		typeof manifest === "object" && manifest !== null && "version" in manifest
			? manifest.version
			: undefined;
	if (typeof version !== "string" || version.trim() === "") {
		throw new Error(`Invalid Admin package version in ${manifestUrl.href}`);
	}
	return `^${version}`;
}
