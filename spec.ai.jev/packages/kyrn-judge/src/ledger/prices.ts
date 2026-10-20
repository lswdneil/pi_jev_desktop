import type { ModelPrice, PriceLookup } from "./aggregate.ts";

/**
 * What a judge call costs, when anyone knows.
 *
 * The number has to come from somewhere authoritative: the model catalog the host already has. The kernel
 * does not import that catalog (a judge extension bundle would grow by a megabyte for one column), so the
 * host — or the `mu ledger --cost` CLI, which is not bundled — passes a lookup in.
 *
 * The one price the kernel does state is the free route: `jev-1.13-free` on OpenCode Zen costs nothing
 * today, and a cost report that leaves it unknown would be wrong in the direction of alarm.
 */

const FREE_ROUTES: Readonly<Record<string, ModelPrice>> = {
	"opencode/jev-1.13-free": { inputPerMillion: 0, outputPerMillion: 0 },
	"jev-1.13-free": { inputPerMillion: 0, outputPerMillion: 0 },
};

/** The price of a route that is free to the user, when the id names one. Both names are checked: a judge
 * may record the route as the provider ("classifier:opencode/jev-1.13-free") or as the model. */
export function freeRoutePrice(model: { providerId?: string; modelId?: string }): ModelPrice | null {
	for (const candidate of [model.modelId ?? "", model.providerId ?? ""]) {
		if (!candidate) continue;
		if (candidate in FREE_ROUTES) return FREE_ROUTES[candidate] ?? null;
		const suffix = Object.keys(FREE_ROUTES).find(
			(name) => candidate.endsWith(`/${name}`) || candidate.endsWith(name),
		);
		if (suffix) return FREE_ROUTES[suffix] ?? null;
	}
	return null;
}

/** The first lookup that knows the model wins; the rest are asked in order. */
export function composePriceLookup(...lookups: readonly PriceLookup[]): PriceLookup {
	return (model) => {
		for (const lookup of lookups) {
			const price = lookup(model);
			if (price) return price;
		}
		return null;
	};
}

/** Prices a caller resolved elsewhere (an env override, a config file, a test). */
export function tablePriceLookup(table: Readonly<Record<string, ModelPrice>>): PriceLookup {
	return (model) => {
		if (model.modelId && `${model.providerId}/${model.modelId}` in table) {
			return table[`${model.providerId}/${model.modelId}`] ?? null;
		}
		return model.modelId && model.modelId in table ? (table[model.modelId] ?? null) : null;
	};
}
