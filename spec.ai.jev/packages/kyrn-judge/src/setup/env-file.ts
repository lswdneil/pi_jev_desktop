/**
 * The `.env` the launcher reads (the checkout's, or ~/.mu/.env for the npm package): read the way kyrn/bin/mu.mjs
 * reads it (parseEnvFile there; a test holds the two to the same answers), and changed one variable at a time, every
 * other line kept as it was. A value is data: nothing in the file is executed, but `$VAR` and `${VAR}` in it are
 * references and are resolved — see `expandEnvValue`.
 */

export interface EnvEntry {
	readonly name: string;
	readonly value: string;
	/** The lines the definition takes, first and last (a quoted value may go on over several). */
	readonly first: number;
	readonly last: number;
}

const DEFINITION = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function closingQuote(text: string, quote: string): number {
	for (let index = 0; index < text.length; index++) {
		if (quote === '"' && text[index] === "\\") index++;
		else if (text[index] === quote) return index;
	}
	return -1;
}

/** Every definition in the file, in order, with where it is. Lines that are none are skipped, as the launcher skips them. */
export function readEnvEntries(text: string): EnvEntry[] {
	const entries: EnvEntry[] = [];
	const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index].trim();
		if (!line || line.startsWith("#")) continue;
		const match = DEFINITION.exec(line);
		if (!match) continue;
		const [, name, rest] = match;
		const quote = rest[0];
		if (quote !== '"' && quote !== "'") {
			entries.push({ name, value: rest.replace(/\s+#.*$/, "").trim(), first: index, last: index });
			continue;
		}
		let body = rest.slice(1);
		let end = closingQuote(body, quote);
		const startedAt = index;
		while (end < 0 && index + 1 < lines.length) {
			body += `\n${lines[++index]}`;
			end = closingQuote(body, quote);
		}
		if (end < 0) {
			index = startedAt;
			continue;
		}
		const value = body.slice(0, end);
		entries.push({
			name,
			value: quote === '"' ? value.replace(/\\(["\\$`])/g, "$1") : value,
			first: startedAt,
			last: index,
		});
	}
	return entries;
}

/**
 * The file without `name`: every definition of it dropped, the other lines (and their comments) kept as they
 * are. Used when a value has moved somewhere better than a text file.
 */
export function removeEnvValue(text: string, name: string): string {
	const newline = text.includes("\r\n") ? "\r\n" : "\n";
	const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
	const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
	const found = readEnvEntries(text).filter((entry) => entry.name === name);
	if (found.length === 0) return text;
	const drop = new Set<number>();
	for (const entry of found) for (let line = entry.first; line <= entry.last; line++) drop.add(line);
	const next = lines.filter((_line, index) => !drop.has(index));
	return `${bom}${next.join(newline)}`;
}

/** The value of `name` as the launcher would take it from the file: its first definition, references resolved. */
export function envFileValue(
	text: string,
	name: string,
	env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
	const raw = readEnvEntries(text).find((entry) => entry.name === name)?.value;
	if (raw === undefined) return undefined;
	// A reference to an unset variable keeps the text as written: turning it into "" would make a missing key
	// look like an empty one, which is the failure mode this resolution exists to end.
	return resolveEnvValue(raw, env) ?? raw;
}

/**
 * `$VAR` and `${VAR}` filled in from `env` first and `process.env` second, or undefined when a reference names
 * a variable that is set neither place. `$$` is a literal `$`, `$!` a literal `!`.
 *
 * The same template rules as `resolveConfigValue` in pi (`packages/coding-agent/src/core/resolve-config-value.ts`,
 * which also runs `!command` values — deliberately not here: a `.env` is data). A test holds the two to the same
 * answers, so an API key written as `$MY_KEY` means one thing everywhere.
 */
export function resolveEnvValue(
	value: string,
	env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
	let resolved = "";
	let index = 0;
	while (index < value.length) {
		const dollar = value.indexOf("$", index);
		if (dollar < 0) {
			resolved += value.slice(index);
			break;
		}
		resolved += value.slice(index, dollar);
		const next = value[dollar + 1];
		if (next === "$" || next === "!") {
			resolved += next;
			index = dollar + 2;
			continue;
		}
		if (next === "{") {
			const end = value.indexOf("}", dollar + 2);
			const name = end < 0 ? "" : value.slice(dollar + 2, end);
			if (end > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
				const found = env[name] || process.env[name];
				if (found === undefined) return undefined;
				resolved += found;
				index = end + 1;
				continue;
			}
			resolved += "$";
			index = dollar + 1;
			continue;
		}
		const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(value.slice(dollar + 1))?.[0];
		if (name !== undefined) {
			const found = env[name] || process.env[name];
			if (found === undefined) return undefined;
			resolved += found;
			index = dollar + 1 + name.length;
			continue;
		}
		resolved += "$";
		index = dollar + 1;
	}
	return resolved;
}

/** `resolveEnvValue`, but a value with no references is returned untouched and a missing one is kept as written. */
export function expandEnvValue(value: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
	return resolveEnvValue(value, env) ?? value;
}

/** A value written so that the launcher reads it back unchanged: bare when it is plain, else quoted. */
export function formatEnvValue(value: string): string {
	if (/^[A-Za-z0-9_./:@+-]*$/.test(value)) return value;
	if (!value.includes("'")) return `'${value}'`;
	return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

/**
 * The file with `name` set to `value`: its first definition replaced in place (with its `export` if it had one),
 * later ones removed, as they would never be read; appended at the end when there is none. The file's own line
 * endings are kept.
 */
export function setEnvValue(text: string, name: string, value: string): string {
	const newline = text.includes("\r\n") ? "\r\n" : "\n";
	const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
	const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
	const found = readEnvEntries(text).filter((entry) => entry.name === name);
	const assignment = (exported: boolean) => `${exported ? "export " : ""}${name}=${formatEnvValue(value)}`;
	if (found.length === 0) {
		const body = lines.join(newline);
		const separator = body === "" || body.endsWith(newline) ? "" : newline;
		return `${bom}${body}${separator}${assignment(false)}${newline}`;
	}
	const drop = new Set<number>();
	for (const entry of found.slice(1)) for (let line = entry.first; line <= entry.last; line++) drop.add(line);
	const [first] = found;
	const exported = /^\s*export\s/.test(lines[first.first]);
	const next: string[] = [];
	for (let index = 0; index < lines.length; index++) {
		if (drop.has(index)) continue;
		if (index === first.first) next.push(assignment(exported));
		else if (index > first.first && index <= first.last) continue;
		else next.push(lines[index]);
	}
	return `${bom}${next.join(newline)}`;
}
