import { getMenuWithDb } from "emdash";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

const db = new Kysely({
	dialect: new PostgresDialect({
		pool: new Pool({ connectionString: process.env.DATABASE_URL }),
	}),
});

export function getNavigation() {
	return getMenuWithDb("primary", db, { locale: "en" });
}
