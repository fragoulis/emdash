import { sql, type Kysely } from "kysely";

import { getI18nConfig } from "../../i18n/config.js";
import { currentTimestamp, isPostgres, tableExists } from "../dialect-helpers.js";

const DEFAULT_SITE_ID = "site-default";

async function hasColumn(db: Kysely<unknown>, table: string, name: string): Promise<boolean> {
	return (
		(await db.introspection.getTables())
			.find((entry) => entry.name === table)
			?.columns.some((column) => column.name === name) ?? false
	);
}

export async function up(db: Kysely<unknown>): Promise<void> {
	if (isPostgres(db)) {
		await sql`ALTER TABLE _emdash_menus ADD COLUMN IF NOT EXISTS site_id text`.execute(db);
		await sql`UPDATE _emdash_menus SET site_id = ${DEFAULT_SITE_ID} WHERE site_id IS NULL`.execute(
			db,
		);
		await sql`ALTER TABLE _emdash_menus ALTER COLUMN site_id SET NOT NULL`.execute(db);
		await sql`ALTER TABLE _emdash_menus DROP CONSTRAINT IF EXISTS _emdash_menus_name_locale_unique`.execute(
			db,
		);
		await sql`ALTER TABLE _emdash_menu_items ADD COLUMN IF NOT EXISTS site_id text`.execute(db);
		await sql`UPDATE _emdash_menu_items AS i SET site_id = m.site_id FROM _emdash_menus AS m WHERE i.menu_id = m.id AND i.site_id IS NULL`.execute(
			db,
		);
		await sql`ALTER TABLE _emdash_menu_items ALTER COLUMN site_id SET NOT NULL`.execute(db);
	} else {
		await rebuildItems(db);
		await rebuildMenus(db);
	}
	await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_emdash_menus_site_name_locale ON _emdash_menus (site_id, name, locale)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS idx_emdash_menus_site_id ON _emdash_menus (site_id)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS idx_emdash_menu_items_site_id ON _emdash_menu_items (site_id)`.execute(
		db,
	);
}

async function rebuildItems(db: Kysely<unknown>): Promise<void> {
	if (
		!(await tableExists(db, "_emdash_menu_items")) &&
		(await tableExists(db, "_emdash_menu_items_site_new"))
	) {
		await db.schema
			.alterTable("_emdash_menu_items_site_new")
			.renameTo("_emdash_menu_items")
			.execute();
	}
	if (!(await hasColumn(db, "_emdash_menu_items", "site_id"))) {
		await db.schema.dropTable("_emdash_menu_items_site_new").ifExists().execute();
		await db.schema
			.createTable("_emdash_menu_items_site_new")
			.addColumn("id", "text", (c) => c.primaryKey())
			.addColumn("menu_id", "text", (c) => c.notNull())
			.addColumn("parent_id", "text")
			.addColumn("sort_order", "integer", (c) => c.notNull().defaultTo(0))
			.addColumn("type", "text", (c) => c.notNull())
			.addColumn("reference_collection", "text")
			.addColumn("reference_id", "text")
			.addColumn("custom_url", "text")
			.addColumn("label", "text", (c) => c.notNull())
			.addColumn("title_attr", "text")
			.addColumn("target", "text")
			.addColumn("css_classes", "text")
			.addColumn("created_at", "text", (c) => c.defaultTo(currentTimestamp(db)))
			.addColumn("locale", "text", (c) =>
				c.notNull().defaultTo(getI18nConfig()?.defaultLocale ?? "en"),
			)
			.addColumn("translation_group", "text")
			.addColumn("site_id", "text", (c) => c.notNull())
			.execute();
		await sql`INSERT INTO _emdash_menu_items_site_new (
			id, menu_id, parent_id, sort_order, type, reference_collection, reference_id,
			custom_url, label, title_attr, target, css_classes, created_at, locale,
			translation_group, site_id
		) SELECT i.id, i.menu_id, i.parent_id, i.sort_order, i.type, i.reference_collection,
			i.reference_id, i.custom_url, i.label, i.title_attr, i.target, i.css_classes,
			i.created_at, i.locale, i.translation_group, ${DEFAULT_SITE_ID}
		FROM _emdash_menu_items AS i`.execute(db);
		await db.schema.dropTable("_emdash_menu_items").execute();
		await db.schema
			.alterTable("_emdash_menu_items_site_new")
			.renameTo("_emdash_menu_items")
			.execute();
	}
	await sql`CREATE INDEX IF NOT EXISTS idx_menu_items_menu ON _emdash_menu_items (menu_id, sort_order)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS idx_menu_items_parent ON _emdash_menu_items (parent_id)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS idx__emdash_menu_items_locale ON _emdash_menu_items (locale)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS idx__emdash_menu_items_translation_group ON _emdash_menu_items (translation_group)`.execute(
		db,
	);
}

async function rebuildMenus(db: Kysely<unknown>): Promise<void> {
	if (
		!(await tableExists(db, "_emdash_menus")) &&
		(await tableExists(db, "_emdash_menus_site_new"))
	) {
		await db.schema.alterTable("_emdash_menus_site_new").renameTo("_emdash_menus").execute();
	}
	if (!(await hasColumn(db, "_emdash_menus", "site_id"))) {
		await db.schema.dropTable("_emdash_menus_site_new").ifExists().execute();
		await db.schema
			.createTable("_emdash_menus_site_new")
			.addColumn("id", "text", (c) => c.primaryKey())
			.addColumn("name", "text", (c) => c.notNull())
			.addColumn("label", "text", (c) => c.notNull())
			.addColumn("created_at", "text", (c) => c.defaultTo(currentTimestamp(db)))
			.addColumn("updated_at", "text", (c) => c.defaultTo(currentTimestamp(db)))
			.addColumn("locale", "text", (c) =>
				c.notNull().defaultTo(getI18nConfig()?.defaultLocale ?? "en"),
			)
			.addColumn("translation_group", "text")
			.addColumn("site_id", "text", (c) => c.notNull())
			.execute();
		await sql`INSERT INTO _emdash_menus_site_new
			(id, name, label, created_at, updated_at, locale, translation_group, site_id)
			SELECT id, name, label, created_at, updated_at, locale, translation_group,
			${DEFAULT_SITE_ID} FROM _emdash_menus`.execute(db);
		await db.schema.dropTable("_emdash_menus").execute();
		await db.schema.alterTable("_emdash_menus_site_new").renameTo("_emdash_menus").execute();
	}
	await sql`CREATE INDEX IF NOT EXISTS idx__emdash_menus_locale ON _emdash_menus (locale)`.execute(
		db,
	);
	await sql`CREATE INDEX IF NOT EXISTS idx__emdash_menus_translation_group ON _emdash_menus (translation_group)`.execute(
		db,
	);
}

export async function down(_db: Kysely<unknown>): Promise<void> {}
