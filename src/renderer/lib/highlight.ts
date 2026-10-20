// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

/**
 * Syntax highlighting without HTML strings: Shiki tokenizes into spans, and the renderer builds React elements from
 * those tokens. The grammars load on demand, so a conversation with no code pays nothing for them.
 */

import type { HighlighterCore } from "shiki/core";

export interface HighlightToken {
	readonly content: string;
	readonly color?: string;
}

const LANGUAGES: Readonly<Record<string, string>> = {
	ts: "typescript",
	typescript: "typescript",
	tsx: "tsx",
	js: "typescript",
	javascript: "typescript",
	jsx: "tsx",
	json: "json",
	sh: "bash",
	shell: "bash",
	zsh: "bash",
	bash: "bash",
	py: "python",
	python: "python",
	diff: "diff",
	patch: "diff",
};

let highlighterPromise: Promise<HighlighterCore> | undefined;

async function highlighter(): Promise<HighlighterCore> {
	highlighterPromise ??= (async () => {
		const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, theme, ...langs] = await Promise.all([
			import("shiki/core"),
			import("shiki/engine/javascript"),
			import("shiki/themes/github-dark.mjs"),
			import("shiki/langs/typescript.mjs"),
			import("shiki/langs/tsx.mjs"),
			import("shiki/langs/json.mjs"),
			import("shiki/langs/bash.mjs"),
			import("shiki/langs/python.mjs"),
			import("shiki/langs/diff.mjs"),
		]);
		return createHighlighterCore({
			themes: [theme.default],
			langs: langs.map((language) => language.default),
			engine: createJavaScriptRegexEngine(),
		});
	})();
	return highlighterPromise;
}

export async function highlight(code: string, language: string | undefined): Promise<readonly (readonly HighlightToken[])[] | undefined> {
	const id = language === undefined ? undefined : LANGUAGES[language.toLowerCase()];
	if (id === undefined) return undefined;
	try {
		const instance = await highlighter();
		return instance.codeToTokens(code, { lang: id, theme: "github-dark" }).tokens;
	} catch {
		return undefined;
	}
}
