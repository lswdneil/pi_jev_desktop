// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationStore } from "../../src/renderer/lib/conversation-store.ts";

afterEach(() => vi.unstubAllGlobals());

describe("conversation store", () => {
	it("folds a burst of events once per frame", () => {
		const schedule = vi.fn(() => 1);
		vi.stubGlobal("requestAnimationFrame", schedule);
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		const store = new ConversationStore();
		const listener = vi.fn();
		store.subscribe(listener);
		store.push({ type: "agent_start" });
		store.push({ type: "turn_start" });
		expect(schedule).toHaveBeenCalledTimes(1);
		expect(listener).not.toHaveBeenCalled();
		store.flush();
		expect(listener).toHaveBeenCalledTimes(1);
		expect(store.getSnapshot().running).toBe(true);
	});

	it("cancels the old frame and schedules a new session independently", () => {
		let frame = 0;
		const schedule = vi.fn(() => ++frame);
		const cancel = vi.fn();
		vi.stubGlobal("requestAnimationFrame", schedule);
		vi.stubGlobal("cancelAnimationFrame", cancel);
		const store = new ConversationStore();
		store.push({ type: "agent_start" });
		store.reset();
		expect(cancel).toHaveBeenCalledWith(1);
		store.push({ type: "turn_start" });
		expect(schedule).toHaveBeenCalledTimes(2);
		store.flush();
		expect(store.getSnapshot().revision).toBe(1);
		expect(store.getSnapshot().board.turn).toBe(1);
	});

	it("refuses a history response from before a session reset", () => {
		const store = new ConversationStore();
		const epoch = store.getEpoch();
		store.reset();
		store.seed([{ role: "user", text: "old session" }], epoch);
		expect(store.getSnapshot().messages).toEqual([]);
		store.seed([{ role: "user", text: "new session" }], store.getEpoch());
		expect(store.getSnapshot().messages[0]?.text).toBe("new session");
	});
});
