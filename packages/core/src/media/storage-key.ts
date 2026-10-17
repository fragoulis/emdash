import { ulid } from "ulidx";

import { selectedSiteId } from "../database/repositories/site-settings.js";

export function newMediaStorageKey(extension: string, id: string = ulid()): string {
	return `sites/${encodeURIComponent(selectedSiteId())}/media/${id}${extension}`;
}
