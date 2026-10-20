import { loadConfig } from "./config.js";

export function describe(input) {
	return loadConfig(input).name;
}
