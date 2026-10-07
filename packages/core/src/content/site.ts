import { getRequestContext } from "../request-context.js";

/** The default site preserves single-site callers that have no host context. */
export function contentSiteId(): string {
	return getRequestContext()?.siteId ?? "site-default";
}
