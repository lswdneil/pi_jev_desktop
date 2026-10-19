// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { describe, expect, it } from "vitest";
import { INVOKE_CHANNELS } from "../../src/shared/api.ts";
import { type ApiDependencies, createApi } from "../../src/main/ipc.ts";
import { NotRunningError } from "../../src/main/supervisor.ts";

/**
 * The bridge's allow-list and its payload checks. A page cannot name a channel of its own, and a channel that exists
 * still gets its payload validated before anything happens.
 */

function build(overrides: Partial<ApiDependencies> = {}): {
	readonly api: ReturnType<typeof createApi>;
	readonly calls: string[];
} {
	const calls: string[] = [];
	const dependencies: ApiDependencies = {
		version: "0.1.0",
		platform: "linux",
		supervisor: {
			getStatus: () => ({ state: "stopped" }),
			restart: async () => {
				calls.push("restart");
				return { state: "running" };
			},
			stop: async () => {
				calls.push("stop");
			},
			prompt: async (message) => {
				calls.push(`prompt:${message}`);
				return { disposition: "started" };
			},
			abort: async () => {
				calls.push("abort");
			},
			snapshot: async () => ({ sessionId: "session-1" }),
			history: async () => {
				calls.push("history");
				return [{ role: "user", text: "earlier" }];
			},
			newSession: async () => {
				calls.push("new-session");
			},
			models: async () => {
				calls.push("models");
				return [{ provider: "anthropic", id: "claude-sonnet-4" }];
			},
			setModel: async (provider, modelId) => {
				calls.push(`set-model:${provider}/${modelId}`);
			},
			respond: (answer) => {
				calls.push(`respond:${answer.id}:${JSON.stringify(answer)}`);
			},
		},
		workspace: {
			current: async () => {
				calls.push("workspace-current");
				return { path: "/workspace/project" };
			},
			choose: async () => {
				calls.push("workspace-choose");
				return { path: "/workspace/next", cancelled: false, status: { state: "running" } };
			},
			open: async (path) => {
				calls.push(`workspace-open:${path}`);
				return { path, cancelled: false, status: { state: "running" } };
			},
			readFile: async (path) => {
				calls.push(`read-file:${path}`);
				return { path, text: "hello", truncated: false, binary: false };
			},
		},
		sessions: {
			list: async () => {
				calls.push("sessions-list");
				return [{ path: "/workspace/session.jsonl", id: "s-1", title: "First task", cwd: "/workspace", updatedAt: "2026-10-19T10:00:00.000Z" }];
			},
			open: async (path) => {
				calls.push(`sessions-open:${path}`);
			},
			rename: async (name) => {
				calls.push(`sessions-rename:${name}`);
			},
		},
		settings: {
			snapshot: async () => {
				calls.push("settings-snapshot");
				return { manifest: { version: 1 }, document: {}, path: "/home/ada/.spec.ai.jev/agent/mu.json", problems: [] };
			},
			write: async (change) => {
				calls.push(`write:${change.feature}.${change.option}=${JSON.stringify(change.value)}`);
				return { manifest: { version: 1 }, document: {}, path: "/home/ada/.spec.ai.jev/agent/mu.json", problems: [] };
			},
		},
		consent: {
			status: async () => {
				calls.push("consent-status");
				return { granted: false, fromEnvironment: false, agreedAt: undefined, file: "/home/ada/.spec.ai.jev/agent/consent.json" };
			},
			grant: async () => {
				calls.push("consent-grant");
				return { granted: true, fromEnvironment: false, agreedAt: "2026-10-18T00:00:00.000Z", file: "/x" };
			},
			revoke: async () => {
				calls.push("consent-revoke");
				return { granted: false, fromEnvironment: false, agreedAt: undefined, file: "/x" };
			},
		},
		judgments: {
			recent: async () => {
				calls.push("judgments-recent");
				return [{ id: "j-1", specId: "turn.continue", mode: "active", providerId: "jev" }];
			},
		},
		update: {
			check: async () => {
				calls.push("update-check");
				return { status: { state: "up-to-date", current: "0.1.8" }, feedUrl: "https://github.com/lswdneil/pi_jev_desktop/releases/latest/download/latest.yml" };
			},
			install: async () => {
				calls.push("update-install");
				return { state: "refused", reason: "this build carries no update public key" };
			},
		},
		preview: {
			open: async (url) => {
				calls.push(`open:${url}`);
			},
			close: async () => {
				calls.push("close");
			},
		},
		...overrides,
	};
	return { api: createApi(dependencies), calls };
}

describe("the allow-list", () => {
	it("is exactly the channels the preload calls", () => {
		const { api } = build();
		expect(api.channels).toBe(INVOKE_CHANNELS);
		expect([...INVOKE_CHANNELS]).toEqual([
			"app:version",
			"app:platform",
			"harness:status",
			"harness:restart",
			"harness:stop",
			"harness:prompt",
			"harness:abort",
			"harness:snapshot",
			"harness:history",
			"harness:new-session",
			"harness:models",
			"harness:set-model",
			"harness:ui-response",
			"workspace:current",
			"workspace:choose",
			"workspace:open",
			"workspace:read-file",
			"sessions:list",
			"sessions:open",
			"sessions:rename",
			"judgments:recent",
			"update:check",
			"update:install",
			"settings:snapshot",
			"settings:write",
			"consent:status",
			"consent:grant",
			"consent:revoke",
			"preview:open",
			"preview:close",
		]);
	});

	it("refuses a channel that is not on it, without doing anything", async () => {
		const { api, calls } = build();

		const result = await api.dispatch("harness:format-disk", { path: "C:\\" });

		expect(result).toEqual({ ok: false, error: { code: "unknown-channel", message: "there is no handler for harness:format-disk" } });
		expect(calls).toEqual([]);
	});

	it("refuses the event channels, which are main-to-renderer only", async () => {
		const { api } = build();
		await expect(api.dispatch("harness:agent-event", {})).resolves.toMatchObject({
			ok: false,
			error: { code: "unknown-channel" },
		});
	});
});

describe("payload checks", () => {
	it("needs a message to prompt", async () => {
		const { api, calls } = build();
		for (const payload of [undefined, {}, { message: "" }, { message: "   " }, { message: 42 }]) {
			await expect(api.dispatch("harness:prompt", payload)).resolves.toMatchObject({
				ok: false,
				error: { code: "invalid-payload" },
			});
		}
		expect(calls).toEqual([]);
	});

	it("refuses a prompt that is really a file", async () => {
		const { api, calls } = build();
		const result = await api.dispatch("harness:prompt", { message: "x".repeat(200_001) });
		expect(result).toMatchObject({ ok: false, error: { code: "invalid-payload" } });
		expect(calls).toEqual([]);
	});

	it("passes a real prompt through", async () => {
		const { api, calls } = build();
		const result = await api.dispatch("harness:prompt", { message: "say hello" });
		expect(result).toEqual({ ok: true, value: { disposition: "started" } });
		expect(calls).toEqual(["prompt:say hello"]);
	});

	it("only previews http and https", async () => {
		const { api, calls } = build();
		for (const payload of [undefined, {}, { url: "file:///etc/passwd" }, { url: "javascript:alert(1)" }, { url: 7 }]) {
			await expect(api.dispatch("preview:open", payload)).resolves.toMatchObject({
				ok: false,
				error: { code: "invalid-payload" },
			});
		}
		expect(calls).toEqual([]);

		await expect(api.dispatch("preview:open", { url: "https://example.com/x" })).resolves.toEqual({
			ok: true,
			value: undefined,
		});
		expect(calls).toEqual(["open:https://example.com/x"]);
	});
});

describe("failures", () => {
	it("keeps 'the agent is not running' apart from a real error", async () => {
		const { api } = build({
			supervisor: {
				getStatus: () => ({ state: "stopped" }),
				restart: () => Promise.reject(new NotRunningError()),
				stop: async () => {},
				prompt: () => Promise.reject(new NotRunningError()),
				abort: async () => {},
				snapshot: () => Promise.reject(new NotRunningError()),
				history: () => Promise.reject(new NotRunningError()),
				newSession: () => Promise.reject(new NotRunningError()),
				models: () => Promise.reject(new NotRunningError()),
				setModel: () => Promise.reject(new NotRunningError()),
				respond: () => {},
			},
			workspace: {
				current: async () => ({ path: "/workspace" }),
				choose: async () => ({ path: "/workspace", cancelled: true, status: { state: "stopped" } }),
				open: async (path) => ({ path, cancelled: false, status: { state: "running" } }),
				readFile: async (path) => ({ path, text: "", truncated: false, binary: false }),
			},
		});

		await expect(api.dispatch("harness:prompt", { message: "hi" })).resolves.toMatchObject({
			ok: false,
			error: { code: "not-running", message: "the agent is not running" },
		});
	});

	it("turns any other throw into a failed call rather than an unhandled rejection", async () => {
		const { api } = build({
			supervisor: {
				getStatus: () => ({ state: "running" }),
				restart: async () => ({}),
				stop: async () => {},
				prompt: () => Promise.reject(new Error("prompt failed: no model")),
				abort: async () => {},
				snapshot: async () => ({}),
				history: async () => [],
				newSession: async () => {},
				models: async () => [],
				setModel: async () => {},
				respond: () => {},
			},
			workspace: {
				current: async () => ({ path: "/workspace" }),
				choose: async () => ({ path: "/workspace", cancelled: true, status: { state: "stopped" } }),
				open: async (path) => ({ path, cancelled: false, status: { state: "running" } }),
				readFile: async (path) => ({ path, text: "", truncated: false, binary: false }),
			},
		});

		await expect(api.dispatch("harness:prompt", { message: "hi" })).resolves.toEqual({
			ok: false,
			error: { code: "failed", message: "prompt failed: no model" },
		});
	});
});

describe("settings and consent", () => {
	it("passes a change to the settings layer, which is where a value is judged", async () => {
		const { api, calls } = build();
		await expect(api.dispatch("settings:write", { feature: "preflight", option: "thinking", value: true })).resolves.toMatchObject({
			ok: true,
			value: { path: "/home/ada/.spec.ai.jev/agent/mu.json" },
		});
		expect(calls).toContain("write:preflight.thinking=true");
	});

	it("refuses a change that does not name a feature and an option", async () => {
		const { api, calls } = build();
		for (const payload of [undefined, {}, { feature: "preflight" }, { option: "thinking" }, { feature: "", option: "x", value: 1 }]) {
			await expect(api.dispatch("settings:write", payload)).resolves.toMatchObject({
				ok: false,
				error: { code: "invalid-payload" },
			});
		}
		expect(calls).toEqual([]);
	});

	it("needs a provider and an id to set a model", async () => {
		const { api, calls } = build();
		await expect(api.dispatch("harness:set-model", { provider: "anthropic" })).resolves.toMatchObject({
			ok: false,
			error: { code: "invalid-payload" },
		});
		await expect(api.dispatch("harness:set-model", { provider: "anthropic", modelId: "claude-sonnet-4" })).resolves.toEqual({
			ok: true,
			value: undefined,
		});
		expect(calls).toEqual(["set-model:anthropic/claude-sonnet-4"]);
	});

	it("grants and revokes consent through the harness's own command", async () => {
		const { api, calls } = build();
		await expect(api.dispatch("consent:grant", undefined)).resolves.toMatchObject({
			ok: true,
			value: { granted: true },
		});
		await expect(api.dispatch("consent:revoke", undefined)).resolves.toMatchObject({
			ok: true,
			value: { granted: false },
		});
		expect(calls).toEqual(["consent-grant", "consent-revoke"]);
	});

	it("passes an answer back with exactly one of value, confirmation or cancellation", async () => {
		const { api, calls } = build();
		await expect(api.dispatch("harness:ui-response", { id: "ui-1", confirmed: false })).resolves.toEqual({
			ok: true,
			value: undefined,
		});
		await expect(api.dispatch("harness:ui-response", { id: "ui-2", value: "main" })).resolves.toEqual({
			ok: true,
			value: undefined,
		});
		await expect(api.dispatch("harness:ui-response", { id: "ui-3", cancelled: true })).resolves.toEqual({
			ok: true,
			value: undefined,
		});
		expect(calls).toEqual([
			'respond:ui-1:{"id":"ui-1","confirmed":false}',
			'respond:ui-2:{"id":"ui-2","value":"main"}',
			'respond:ui-3:{"id":"ui-3","cancelled":true}',
		]);
	});

	it("refuses an answer with no id, or with nothing to say", async () => {
		const { api, calls } = build();
		for (const payload of [undefined, {}, { id: "" }, { id: "ui-1" }, { id: "ui-1", value: 5 }]) {
			await expect(api.dispatch("harness:ui-response", payload)).resolves.toMatchObject({
				ok: false,
				error: { code: "invalid-payload" },
			});
		}
		expect(calls).toEqual([]);
	});

	it("reads the ledger through its own channel", async () => {
		const { api, calls } = build();
		await expect(api.dispatch("judgments:recent", undefined)).resolves.toMatchObject({
			ok: true,
			value: [{ specId: "turn.continue" }],
		});
		expect(calls).toEqual(["judgments-recent"]);
	});

	it("reads and chooses a workspace through named channels", async () => {
		const { api, calls } = build();
		await expect(api.dispatch("workspace:current", undefined)).resolves.toEqual({
			ok: true,
			value: { path: "/workspace/project" },
		});
		await expect(api.dispatch("workspace:choose", undefined)).resolves.toMatchObject({
			ok: true,
			value: { path: "/workspace/next", cancelled: false, status: { state: "running" } },
		});
		await expect(api.dispatch("workspace:open", { path: "/workspace/known" })).resolves.toMatchObject({
			ok: true,
			value: { path: "/workspace/known", cancelled: false },
		});
		await expect(api.dispatch("workspace:open", {})).resolves.toMatchObject({
			ok: false,
			error: { code: "invalid-payload" },
		});
		await expect(api.dispatch("workspace:read-file", { path: "/workspace/file.ts" })).resolves.toMatchObject({
			ok: true,
			value: { text: "hello" },
		});
		await expect(api.dispatch("workspace:read-file", {})).resolves.toMatchObject({
			ok: false,
			error: { code: "invalid-payload" },
		});
		expect(calls).toEqual([
			"workspace-current",
			"workspace-choose",
			"workspace-open:/workspace/known",
			"read-file:/workspace/file.ts",
		]);
	});

	it("lists and opens saved sessions through named channels", async () => {
		const { api, calls } = build();
		await expect(api.dispatch("sessions:list", undefined)).resolves.toMatchObject({
			ok: true,
			value: [{ id: "s-1", title: "First task" }],
		});
		await expect(api.dispatch("sessions:open", { path: "/workspace/session.jsonl" })).resolves.toEqual({
			ok: true,
			value: undefined,
		});
		await expect(api.dispatch("sessions:open", {})).resolves.toMatchObject({
			ok: false,
			error: { code: "invalid-payload" },
		});
		await expect(api.dispatch("sessions:rename", { name: "Release work" })).resolves.toEqual({
			ok: true,
			value: undefined,
		});
		await expect(api.dispatch("sessions:rename", { name: "  " })).resolves.toMatchObject({
			ok: false,
			error: { code: "invalid-payload" },
		});
		expect(calls).toEqual(["sessions-list", "sessions-open:/workspace/session.jsonl", "sessions-rename:Release work"]);
	});
});

describe("the simple ones", () => {
	it("answers with the app's own facts", async () => {
		const { api } = build();
		await expect(api.dispatch("app:version", undefined)).resolves.toEqual({ ok: true, value: "0.1.0" });
		await expect(api.dispatch("app:platform", undefined)).resolves.toEqual({ ok: true, value: "linux" });
	});

	it("answers with the status, before and after stopping", async () => {
		const { api } = build();
		await expect(api.dispatch("harness:status", undefined)).resolves.toEqual({ ok: true, value: { state: "stopped" } });
		await expect(api.dispatch("harness:restart", undefined)).resolves.toEqual({ ok: true, value: { state: "running" } });
		await expect(api.dispatch("harness:stop", undefined)).resolves.toEqual({ ok: true, value: { state: "stopped" } });
	});
});
