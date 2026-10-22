import { defineConfig } from "tsdown";

import { getAdminDependencyRange } from "./src/admin-version.ts";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	dts: true,
	clean: true,
	define: {
		__EMDASH_ADMIN_DEPENDENCY_RANGE__: JSON.stringify(getAdminDependencyRange()),
	},
	banner: {
		js: "#!/usr/bin/env node",
	},
});
