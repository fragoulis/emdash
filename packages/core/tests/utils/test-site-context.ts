import { runWithContext, type EmDashRequestContext } from "../../src/request-context.js";

export function runWithDefaultSite<T>(context: EmDashRequestContext, fn: () => T): T {
	return runWithContext({ ...context, siteId: "site-default" }, fn);
}
