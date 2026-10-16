import type { Kysely } from "kysely";

import { TaxonomyRepository as SiteTaxonomyRepository } from "../../src/database/repositories/taxonomy.js";
import type { Database } from "../../src/database/types.js";

export class TaxonomyRepository extends SiteTaxonomyRepository {
	constructor(db: Kysely<Database>) {
		super(db, "site-default");
	}
}
