const UNITS = { ms: 1, s: 1000, m: 60_000 };

export function parseDuration(text) {
	const match = /^(\d+)(ms|s|m)$/.exec(text);
	if (match === null) throw new Error(`not a duration: ${text}`);
	return Number(match[1]) * UNITS[match[2]];
}
