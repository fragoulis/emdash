import ts from "typescript";
import { describe, expect, it } from "vitest";

import { systemSitesSource } from "../src/multisite-system-sites.js";

describe("generated system sites island", () => {
	it("compiles the generated component as TSX", () => {
		const result = ts.transpileModule(systemSitesSource, {
			compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
			reportDiagnostics: true,
		});

		expect(result.diagnostics).toEqual([]);
		expect(result.outputText).not.toBe("");
	});
});
