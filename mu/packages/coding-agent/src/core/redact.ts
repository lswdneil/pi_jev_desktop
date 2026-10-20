/**
 * Credentials out of anything mu writes down: a crash record is written to disk and shown to
 * whoever debugs it, so a stack that carries a key must not carry the key.
 *
 * This is the host-side twin of `packages/kyrn-judge/src/redact.ts`. The dependency only goes
 * host → kernel, not back, so the patterns live twice on purpose; `test/fixtures/redact-vectors.json`
 * is run by both sides' tests, which is what keeps the two implementations on the same behavior.
 *
 * Only what is surely a credential goes, so the words around it keep their meaning
 * ("fix the password reset flow" stays as it is): a token in a shape only credentials have, a value
 * assigned to a name that says it is one, and the values of this process's own credential variables.
 */

export const REDACTED = "[redacted]";

/** Shapes only credentials have. */
const SHAPES: readonly RegExp[] = [
	// A private key, the whole block, or to the end when the text was cut inside it.
	/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
	// OpenAI, Anthropic, OpenRouter, DeepSeek and the like.
	/\bsk-[A-Za-z0-9_-]{20,}/g,
	/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})/g,
	/\bglpat-[A-Za-z0-9_-]{20,}/g,
	/\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
	/\bAIza[0-9A-Za-z_-]{35}/g,
	/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
	/\b[rs]k_(?:live|test)_[0-9A-Za-z]{16,}/g,
	/\bnpm_[A-Za-z0-9]{36}\b/g,
	/\bhf_[A-Za-z0-9]{30,}/g,
	// A JSON web token.
	/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];

/** `Authorization: Bearer …` with a token that has a digit in it ("Basic usage" is words): the scheme stays. */
const BEARER = /\b(Bearer|Basic)(\s+)(?=[A-Za-z._~+/=-]*[0-9])[A-Za-z0-9._~+/=-]{12,}/g;

/** `https://user:password@host`: the user and the host stay. */
const URL_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+(@)/gi;

const KEY_WORD = "(?:SECRET|TOKEN|PASSWD|PASSWORD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY)";

/** `DB_PASSWORD=…`, `export API_KEY="…"`: an environment variable's value, eight characters at least. */
const ENV_VALUE = new RegExp(`\\b([A-Z0-9_]*${KEY_WORD}[A-Z0-9_]*=)("[^"\\n]{8,}"|'[^'\\n]{8,}'|[^\\s"';&|]{8,})`, "g");

/** `"password": "…"`, `apiKey = '…'`: a string literal. */
const QUOTED_VALUE = new RegExp(
	`(["']?[A-Za-z0-9_-]*${KEY_WORD.replaceAll("_?", "[_-]?")}[A-Za-z0-9_-]*["']?\\s*[:=]\\s*)(["'])[^"'\\s]{8,}\\2`,
	"gi",
);

/** `  password: hunter2hunter2` on a line of its own, as YAML and .properties files write it. */
const LINE_VALUE = new RegExp(
	`^(\\s*[A-Za-z0-9_.-]*${KEY_WORD.replaceAll("_?", "[_.-]?")}[A-Za-z0-9_.-]*\\s*[:=][ \\t]*)[^\\s#"']{8,}[ \\t]*$`,
	"gim",
);

/** Names of environment variables that hold credentials. */
const CREDENTIAL_NAME = /SECRET|TOKEN|PASSWD|PASSWORD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL/i;

/**
 * The values of `env`'s credential variables, longest first so none is left half replaced. A short
 * value without a digit is a setting ("undefined", "false"), and replacing it everywhere would cost
 * every other use of that word.
 */
export function environmentSecrets(env: Readonly<Record<string, string | undefined>> = process.env): string[] {
	const values = Object.entries(env).flatMap(([name, raw]) => {
		const value = raw?.trim() ?? "";
		const secretish = value.length >= 16 || (value.length >= 8 && /\d/.test(value));
		return secretish && CREDENTIAL_NAME.test(name) ? [value] : [];
	});
	return [...new Set(values)].sort((a, b) => b.length - a.length);
}

/** `text` with every credential in it replaced by `[redacted]`. `known` are values to take out wherever they are. */
export function redactSecrets(text: string, known: readonly string[] = []): string {
	let clean = text;
	for (const secret of known) if (clean.includes(secret)) clean = clean.split(secret).join(REDACTED);
	for (const shape of SHAPES) clean = clean.replace(shape, REDACTED);
	return clean
		.replace(BEARER, `$1$2${REDACTED}`)
		.replace(URL_PASSWORD, `$1${REDACTED}$2`)
		.replace(ENV_VALUE, `$1${REDACTED}`)
		.replace(QUOTED_VALUE, `$1$2${REDACTED}$2`)
		.replace(LINE_VALUE, `$1${REDACTED}`);
}

/** Something that failed, as the redacted text a crash record keeps. */
export function redactFailure(
	error: unknown,
	known: readonly string[] = [],
): { message: string; stack: string | null } {
	const message = error instanceof Error ? error.message || error.name : describeUnknown(error);
	const stack = error instanceof Error && error.stack ? error.stack : null;
	return { message: redactSecrets(message, known), stack: stack === null ? null : redactSecrets(stack, known) };
}

function describeUnknown(value: unknown): string {
	try {
		return typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
	} catch {
		return String(value);
	}
}
