const UNITS = { s: 1000, m: 60_000 };

export function parseDuration(text) {
	const match = /^(\d+)([a-z]+)$/.exec(text);
	if (match === null) throw new Error(`not a duration: ${text}`);
	const unit = UNITS[match[2]];
	return Number(match[1]) * unit;
}
