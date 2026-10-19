// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * What the harness says, in the reader's language.
 *
 * mu writes presentation events in English with a stable `code` beside the sentence and `params` naming what the
 * sentence mentions (`kyrn/docs/features/presentation-codes.md`). The shell translates by code and keeps the English
 * when it has no translation — an unknown code from a newer harness must show the sentence it came with, not a blank
 * row. Model-written text, paths and commands have no codes and are shown as they are.
 */

export type Params = Readonly<Record<string, string | number>>;

/** One presentation event, as the harness emits it. */
export interface PresentationEvent {
	readonly state?: string;
	readonly code?: string;
	readonly params?: Params;
	readonly reason?: string;
	readonly [key: string]: unknown;
}

/**
 * The codes this build translates, with the English it replaces. A code missing here still shows its own `reason` or
 * `code`, which is what makes the fallback safe to rely on.
 */
const SHELL_TEXTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	en: {
		"permissions.ask": "mu wants to run {command}. Allow it?",
		"permissions.denied": "Not allowed: {command}",
		"permissions.allowed": "Allowed: {command}",
		"board.running": "Running {tool}",
		"board.waiting": "Waiting for your answer",
		"board.done": "Done",
		"judge.fallback": "Answered without the judge ({reason})",
	},
	zh: {
		"permissions.ask": "mu 想执行 {command}，允许吗？",
		"permissions.denied": "已拒绝：{command}",
		"permissions.allowed": "已允许：{command}",
		"board.running": "正在执行 {tool}",
		"board.waiting": "等待你的选择",
		"board.done": "完成",
		"judge.fallback": "未使用判官（{reason}）",
	},
	"zh-TW": {
		"permissions.ask": "mu 想執行 {command}，允許嗎？",
		"permissions.denied": "已拒絕：{command}",
		"permissions.allowed": "已允許：{command}",
		"board.running": "正在執行 {tool}",
		"board.waiting": "等待你的選擇",
		"board.done": "完成",
		"judge.fallback": "未使用判官（{reason}）",
	},
};

function languageOf(language: string): Readonly<Record<string, string>> {
	return SHELL_TEXTS[language] ?? SHELL_TEXTS[language.split("-")[0] ?? "en"] ?? SHELL_TEXTS.en ?? {};
}

/** Fill `{name}` from the event's params. A missing param stays visible as `{name}`, which is a bug worth seeing. */
export function fill(template: string, params: Params | undefined): string {
	if (params === undefined) return template.replace(/\{[a-zA-Z0-9_]+\}/g, "");
	return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, name: string) => {
		const value = params[name];
		return value === undefined ? whole : String(value);
	});
}

/**
 * The text for one event: the shell's translation of its code when there is one, otherwise the English the harness
 * sent, otherwise the code itself. Never empty for an event that has something to say.
 */
export function presentationText(event: PresentationEvent, language: string): string {
	const code = event.code;
	if (code !== undefined) {
		const translated = languageOf(language)[code];
		if (translated !== undefined) return fill(translated, event.params);
	}
	const english = event.reason;
	if (typeof english === "string" && english !== "") return fill(english, event.params);
	if (code !== undefined) return code;
	return "";
}

/** Whether this build knows a code. Used to mark a row that came from a newer harness rather than silently english-ing it. */
export function knowsCode(code: string): boolean {
	return Object.values(SHELL_TEXTS).some((texts) => texts[code] !== undefined);
}
