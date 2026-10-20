import { resolveConfigValue } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { envFileValue, expandEnvValue, resolveEnvValue } from "../src/setup/env-file.ts";

/**
 * `$VAR` in a `.env` value is a reference, not text.
 *
 * This is the bug the expansion exists for: the wizard used to write an API key into `.env` verbatim, so a
 * value written as a reference was stored as five characters of literal text, `Boolean(value)` said "a key is
 * set", and every request then failed. The rules are pi's (`resolveConfigValue`), and a test below holds the
 * two implementations to the same answers so a `.env` and a `agent.json` cannot disagree about what a reference
 * means.
 *
 * The references are built from parts rather than spelled out, because a source file that contains a
 * literal brace-reference reads as template interpolation to the linter — and to the next person.
 */

const DOLLAR = "$";
/** `$NAME`: a reference without braces. */
const dollar = (name: string): string => `${DOLLAR}${name}`;
/** `${NAME}`: the braced form. */
const braced = (name: string): string => `${DOLLAR}{${name}}`;
/** `$$NAME`: the escaped form, which means the text `$NAME`. */
const escapedDollar = (name: string): string => `${DOLLAR}${dollar(name)}`;

const ENV = { HOME: "/home/ada", TOKEN: "sk-from-env", EMPTY: "" };

describe("resolving references in a .env value", () => {
	it("fills in the plain and the braced form from the given environment", () => {
		expect(resolveEnvValue(dollar("TOKEN"), ENV)).toBe("sk-from-env");
		expect(resolveEnvValue(braced("TOKEN"), ENV)).toBe("sk-from-env");
		expect(resolveEnvValue(`prefix-${dollar("TOKEN")}-suffix`, ENV)).toBe("prefix-sk-from-env-suffix");
		expect(resolveEnvValue(`${braced("HOME")}/keys`, ENV)).toBe("/home/ada/keys");
	});

	it("keeps the text when a reference names a variable that is not set", () => {
		expect(resolveEnvValue(dollar("MISSING"), ENV)).toBeUndefined();
		expect(expandEnvValue(dollar("MISSING"), ENV)).toBe(dollar("MISSING"));
		// A key written as a reference to nothing is not a key: the file keeps its text rather than becoming "".
		expect(envFileValue(`K=${dollar("MISSING")}\n`, "K", ENV)).toBe(dollar("MISSING"));
	});

	it("treats an empty variable as unset, the way pi does", () => {
		// `||`, not `??`: a variable set to "" is not a value anyone meant to use, and pi agrees.
		expect(resolveEnvValue(dollar("EMPTY"), ENV)).toBeUndefined();
		expect(resolveEnvValue(dollar("EMPTY"), { EMPTY: "", TOKEN: "fallback" })).toBeUndefined();
	});

	it("escapes a literal dollar with a doubled dollar, and a literal bang with a dollar-bang", () => {
		expect(resolveEnvValue(escapedDollar("HOME"), ENV)).toBe(dollar("HOME"));
		// `$!` is a literal "!" and nothing more: the reference after it still resolves (pi's rule, held by the
		// cross-check below).
		expect(resolveEnvValue(`${DOLLAR}!${dollar("TOKEN")}`, ENV)).toBe("!sk-from-env");
		expect(resolveEnvValue("price: 5$", ENV)).toBe("price: 5$");
	});

	it("reads a value with no reference back unchanged", () => {
		expect(expandEnvValue("sk-literal", ENV)).toBe("sk-literal");
		expect(envFileValue("A=plain\n", "A", ENV)).toBe("plain");
	});
});

describe("the same answers as pi's resolveConfigValue", () => {
	it("agrees on every template the two can both read", () => {
		const vectors = [
			"plain",
			dollar("TOKEN"),
			braced("TOKEN"),
			`a${dollar("TOKEN")} b`,
			`${braced("HOME")}/x`,
			escapedDollar("TOKEN"),
			`${DOLLAR}!${dollar("TOKEN")}`,
			dollar("MISSING"),
			braced("MISSING"),
			"100$",
			`${DOLLAR}{TO}KEN`, // a brace group that is not a name is literal text
			`${DOLLAR}{TOKEN`, // never closed: literal text
		];
		for (const value of vectors) {
			expect(resolveEnvValue(value, ENV), value).toEqual(resolveConfigValue(value, ENV));
		}
	});

	it("is what the wizard uses to decide a key is already configured", () => {
		// The value in the file is a reference that resolves: the key IS configured.
		expect(envFileValue(`TYPESAFE_API_KEY=${dollar("TOKEN")}\n`, "TYPESAFE_API_KEY", ENV)).toBe("sk-from-env");
		// The reference does not resolve: the file does not hold a usable key.
		expect(envFileValue(`TYPESAFE_API_KEY=${dollar("UNSET")}\n`, "TYPESAFE_API_KEY", ENV)).toBe(dollar("UNSET"));
	});
});
