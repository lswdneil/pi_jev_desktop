import { homedir } from "node:os";
import { join } from "node:path";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * One prefix, one spelling. Earlier names are not read: a machine that still
 * carries them starts with the defaults rather than mixing two products' state.
 */
export function specEnv(name: string, env: Env = process.env): string | undefined {
	const value = env[`SPEC_AI_JEV_${name}`];
	return value === undefined || value === "" ? undefined : value;
}

export const CONFIG_FILE = "agent.json";

/** This product's home. The old homes are never read or created beside it. */
export function specHome(home: string = homedir()): string {
	return join(home, ".spec.ai.jev");
}
