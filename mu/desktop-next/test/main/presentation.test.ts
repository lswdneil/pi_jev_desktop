// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { describe, expect, it } from "vitest";
import { fill, knowsCode, presentationText } from "../../src/shared/presentation.ts";

/**
 * Translating what the harness says: by code when this build knows the code, English when it does not, and never an
 * empty line for an event that carried something to say.
 */

describe("the table", () => {
	it("uses the code's translation in the reader's language", () => {
		const event = { code: "permissions.ask", params: { command: "rm -rf build" } };
		expect(presentationText(event, "en")).toBe("mu wants to run rm -rf build. Allow it?");
		expect(presentationText(event, "zh")).toBe("mu 想执行 rm -rf build，允许吗？");
		expect(presentationText(event, "zh-TW")).toBe("mu 想執行 rm -rf build，允許嗎？");
	});

	it("falls back to the base language, then to English", () => {
		const event = { code: "board.running", params: { tool: "bash" } };
		expect(presentationText(event, "zh-Hans")).toBe("正在执行 bash");
		expect(presentationText(event, "de-DE")).toBe("Running bash");
	});
});

describe("a code this build does not know", () => {
	it("shows the English the harness sent, with the params filled in", () => {
		const event = { code: "browser.run.open_failed", reason: "could not open {url} in the browser", params: { url: "https://x.test" } };
		expect(knowsCode("browser.run.open_failed")).toBe(false);
		expect(presentationText(event, "zh")).toBe("could not open https://x.test in the browser");
	});

	it("shows the code itself when there is no English either", () => {
		expect(presentationText({ code: "some.new.code" }, "en")).toBe("some.new.code");
	});

	it("does not invent text for an event with nothing to say", () => {
		expect(presentationText({}, "en")).toBe("");
	});
});

describe("filling a template", () => {
	it("leaves an unknown placeholder visible, because that is a bug worth seeing", () => {
		expect(fill("kill {pid} now", { command: "x" })).toBe("kill {pid} now");
	});

	it("works with no params at all", () => {
		expect(fill("nothing {to} fill", undefined)).toBe("nothing  fill");
	});
});
