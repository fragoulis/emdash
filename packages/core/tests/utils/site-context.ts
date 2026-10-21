import { it as vitestIt } from "vitest";

import { runWithContext } from "../../src/request-context.js";

export function siteIt(name: string, callback: () => Promise<void> | void) {
	return vitestIt(name, () =>
		runWithContext({ editMode: false, siteId: "site-default" }, callback),
	);
}
