import { defineMiddleware } from "astro:middleware";
import { getRequestContext, runWithContext } from "emdash/request-context";

export const onRequest = defineMiddleware((_context, next) =>
	runWithContext({ ...getRequestContext(), editMode: false, siteId: "site-default" }, next),
);
