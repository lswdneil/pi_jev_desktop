/**
 * The shape of `mu.json` across versions, and how an older file becomes the current one.
 *
 * `schemaVersion` is the version of the *file format*, not of mu: the npm package and the desktop app are
 * versioned separately, and a user may run a newer app with an older package. Migrations therefore only ever
 * add or normalise fields, and every one of them is idempotent: running two of them, or the same one twice,
 * produces the same file as running it once.
 *
 * A file with no `schemaVersion` is version 0 — every file written before the field existed.
 */

/** Bump when the file format changes; add a matching entry to `CONFIG_MIGRATIONS`. */
export const CONFIG_SCHEMA_VERSION = 1;

export interface ConfigMigration {
	/** The version this step produces. Steps are applied in order until the file is current. */
	readonly to: number;
	/** One sentence shown to the user, so a moved setting is never a mystery. */
	readonly describe: string;
	apply(value: Record<string, unknown>): Record<string, unknown>;
}

function clone(value: Record<string, unknown>): Record<string, unknown> {
	return { ...value };
}

/** v0 → v1: stamp the version, and read `"tiers": "a,b"` as the list it always meant. */
const toV1: ConfigMigration = {
	to: 1,
	describe: 'stamped schemaVersion and read a comma-separated "tiers" as a list',
	apply(value) {
		const next = clone(value);
		if (typeof next.tiers === "string") {
			next.tiers = next.tiers
				.split(",")
				.map((tier) => tier.trim())
				.filter(Boolean);
		}
		next.schemaVersion = 1;
		return next;
	},
};

export const CONFIG_MIGRATIONS: readonly ConfigMigration[] = [toV1];

/** The version the value claims, or 0 when it predates the field, or undefined when it claims something unusable. */
export function configSchemaVersion(value: unknown): number | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return 0;
	const raw = (value as Record<string, unknown>).schemaVersion;
	if (raw === undefined) return 0;
	if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
	return undefined;
}

export interface MigratedConfig {
	/** The value to hand to `parseConfig`. */
	readonly value: Record<string, unknown>;
	readonly from: number;
	readonly to: number;
	/** One line per applied step, for the user. Empty when the file was already current. */
	readonly notes: readonly string[];
	/** Why the file cannot be read by this build. When set, `value` is the empty object and defaults apply. */
	readonly unsupported?: string;
}

/**
 * Brings a parsed `mu.json` to the current schema. It never throws: a file this build cannot understand comes
 * back with `unsupported` set, so the caller can say why instead of failing to start.
 */
export function migrateConfig(raw: unknown, target = CONFIG_SCHEMA_VERSION): MigratedConfig {
	const version = configSchemaVersion(raw);
	if (version === undefined) {
		return {
			value: {},
			from: version ?? 0,
			to: target,
			notes: [],
			unsupported: "its schemaVersion is not a whole number, so this build cannot tell what format it is in",
		};
	}
	if (version > target) {
		return {
			value: {},
			from: version,
			to: target,
			notes: [],
			unsupported: `it was written by a newer mu (schemaVersion ${version}; this build reads up to ${target}). Upgrade mu, or move the file aside to start from defaults`,
		};
	}
	let value = clone(raw as Record<string, unknown>);
	const notes: string[] = [];
	for (let from = version; from < target; from++) {
		const step = CONFIG_MIGRATIONS.find((candidate) => candidate.to === from + 1);
		if (!step) {
			return {
				value: clone(raw as Record<string, unknown>),
				from: version,
				to: target,
				notes,
				unsupported: `no migration exists from schemaVersion ${from} to ${from + 1}, so this build cannot read it`,
			};
		}
		value = step.apply(value);
		notes.push(`schemaVersion ${from} -> ${step.to}: ${step.describe}`);
	}
	return { value, from: version, to: target, notes };
}
