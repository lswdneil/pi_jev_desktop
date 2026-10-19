// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchApp } from "./helpers/app.ts";

test.skip(
	process.env.PI_JEV_HARNESS === undefined,
	"set PI_JEV_HARNESS to a mu checkout to run the real-harness tests",
);

/**
 * The real harness, a stub provider, real turns.
 *
 * Every other conversation test scripts the harness, so they show the renderer's behaviour but never the wire from the
 * window to mu to a provider and back. These start the checkout's own harness with a `models.json` that points at a
 * local OpenAI-compatible server, and require the answer (and the tool call) to reach the window and the session file.
 *
 * They also pin bugs the fixture could not show: the real harness sends `message_start` *and* `message_end` for the
 * user's prompt (a row for each showed every typed message twice); a failed provider call arrives as an assistant
 * message with empty text and the reason in `errorMessage` (shown as a blank answer, then once per retry); and a tool
 * result arrives both as `tool_execution_*` events and as a message (one command showed as three rows, two with the raw
 * output as their text).
 */

const FAILURE = "the provider is having a bad day";

type Reply =
	| { readonly text: string }
	| { readonly tool: string; readonly args: Readonly<Record<string, unknown>> }
	| { readonly drop: string };

/** A stub provider. `reply` returns the answer for request `index` (1-based), or undefined to fail that request. */
async function startProvider(reply: (index: number) => Reply | undefined) {
	const requests: string[] = [];
	const server = createServer((request, response) => {
		request.on("data", () => undefined);
		request.on("end", () => {
			requests.push(`${request.method} ${request.url}`);
			if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) {
				response.writeHead(404, { "content-type": "application/json" });
				response.end(JSON.stringify({ error: { message: "not found" } }));
				return;
			}
			const next = reply(requests.length);
			if (next === undefined) {
				response.writeHead(500, { "content-type": "application/json" });
				response.end(JSON.stringify({ error: { message: FAILURE, type: "server_error" } }));
				return;
			}
			const chunk = (delta: Record<string, unknown>, finish: string | null): string =>
				`data: ${JSON.stringify({
					id: "stub-1",
					object: "chat.completion.chunk",
					created: 1,
					model: "stub-1",
					choices: [{ index: 0, delta, finish_reason: finish }],
				})}\n\n`;
			response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
			if ("drop" in next) {
				response.write(chunk({ role: "assistant", content: next.drop }, null));
				setTimeout(() => response.destroy(), 200);
				return;
			}
			if ("tool" in next) {
				response.write(
					chunk(
						{
							role: "assistant",
							tool_calls: [
								{
									index: 0,
									id: "call-1",
									type: "function",
									function: { name: next.tool, arguments: JSON.stringify(next.args) },
								},
							],
						},
						null,
					),
				);
				response.write(chunk({}, "tool_calls"));
			} else {
				response.write(chunk({ role: "assistant", content: next.text }, null));
				response.write(chunk({}, "stop"));
			}
			response.write("data: [DONE]\n\n");
			response.end();
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (address === null || typeof address === "string") throw new Error("the stub provider has no port");
	return { port: address.port, requests, close: () => server.close() };
}

/** The first run, choosing the stub model: the only model the temporary home's models.json describes. */
async function firstRun(page: import("@playwright/test").Page): Promise<void> {
	await page.locator('[data-testid="first-run"]').waitFor({ state: "visible", timeout: 90_000 });
	await page.locator('[data-language="en"]').click();
	await page.locator('[data-testid="first-run-next"]').click();
	await page.locator('[data-testid="first-run-decline"]').click();
	const choice = page.locator('[data-testid="first-run-model"] input[value="stub/stub-1"]');
	await choice.waitFor({ state: "attached", timeout: 90_000 });
	await choice.click();
	await page.locator('[data-testid="first-run-finish"]').click();
	await expect(page.locator(".chip")).toContainText("running", { timeout: 120_000 });
}

function modelsJson(port: number): string {
	return `${JSON.stringify({
		providers: {
			stub: { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", apiKey: "stub", models: [{ id: "stub-1", name: "stub-1" }] },
		},
	})}\n`;
}

/** A launched profile whose temporary home already points at `port`. */
async function launchedWith(port: number) {
	return launchApp({
		harness: "checkout",
		prepareHome: (home) => {
			mkdirSync(join(home, ".spec.ai.jev", "agent"), { recursive: true });
			writeFileSync(join(home, ".spec.ai.jev", "agent", "models.json"), modelsJson(port), "utf8");
		},
	});
}

function sessionTextFiles(home: string): string[] {
	const root = join(home, ".spec.ai.jev", "agent", "sessions");
	const found: string[] = [];
	const walk = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith(".jsonl")) found.push(path);
		}
	};
	walk(root);
	return found;
}

test.describe("a real harness with a stub provider", () => {
	test("answers a prompt that reaches the window and the session file", async () => {
		const provider = await startProvider(() => ({ text: "Hello from the stub." }));
		const profile = await launchedWith(provider.port);
		const { page } = profile;
		try {
			await firstRun(page);
			await page.locator('[data-testid="composer"]').fill("hello from the test");
			await page.locator('[data-testid="send"]').click();

			await expect(page.locator('.message[data-role="assistant"] .text').last()).toHaveText("Hello from the stub.", {
				timeout: 120_000,
			});
			// One row for the prompt: the real harness announces its start and its end, and both used to become rows.
			await expect(page.locator('.message[data-role="user"] .text')).toHaveText(["hello from the test"]);
			expect(provider.requests.length, "the harness never called the provider").toBeGreaterThan(0);

			const files = sessionTextFiles(profile.home);
			expect(files.length, "the turn was not written to a session file").toBeGreaterThan(0);
			expect(files.some((file) => readFileSync(file, "utf8").includes("hello from the test"))).toBe(true);
		} finally {
			await profile.close();
			provider.close();
		}
	});

	test("shows a provider failure once, as the reason, instead of a blank answer", async () => {
		// The first request succeeds (the turn is real); every later one fails, which is what a broken provider looks
		// like after the retries are exhausted.
		const provider = await startProvider((index) => (index === 1 ? { text: "Answer one." } : undefined));
		const profile = await launchedWith(provider.port);
		const { page } = profile;
		try {
			await firstRun(page);
			await page.locator('[data-testid="composer"]').fill("first question");
			await page.locator('[data-testid="send"]').click();
			await expect(page.locator('.message[data-role="assistant"] .text').last()).toHaveText("Answer one.", { timeout: 120_000 });

			await page.locator('[data-testid="composer"]').fill("second question");
			await page.locator('[data-testid="send"]').click();

			const failure = page.locator('.message[data-role="assistant"] .text').last();
			await expect(failure).toContainText(FAILURE, { timeout: 180_000 });
			// One row for the failure, whatever the retry policy did, and no empty assistant rows anywhere.
			await expect(page.locator('.message[data-role="assistant"] .text')).toHaveCount(2);
			const texts = await page.locator('.message[data-role="assistant"] .text').allTextContents();
			for (const text of texts) expect(text.trim(), "a blank assistant row is on screen").not.toBe("");
			await expect(page.locator('[data-testid="composer"]')).toBeEnabled();
		} finally {
			await profile.close();
			provider.close();
		}
	});

	test("shows a dropped stream once, as one reason, and stays usable", async () => {
		// The provider starts an answer and then drops the connection; the harness retries and gives up.
		const provider = await startProvider(() => ({ drop: "Partial answer" }));
		const profile = await launchedWith(provider.port);
		const { page } = profile;
		try {
			await firstRun(page);
			await page.locator('[data-testid="composer"]').fill("a question");
			await page.locator('[data-testid="send"]').click();

			const answer = page.locator('.message[data-role="assistant"] .text').last();
			await expect(answer).toHaveText(/terminated|aborted|socket|ECONN|hang up|error/i, { timeout: 180_000 });
			// One row whatever the retry policy did; the partial text is the harness's to keep and it does not.
			await expect(page.locator('.message[data-role="assistant"] .text')).toHaveCount(1);
			await expect(page.locator('[data-testid="composer"]')).toBeEnabled();
			expect(sessionTextFiles(profile.home).length).toBeGreaterThan(0);
		} finally {
			await profile.close();
			provider.close();
		}
	});

	test("asks before a write outside the project, and the denial reaches the model", async () => {
		// No judge is available in this temporary home, so mu asks about a write outside the project. The card is the
		// kernel's, not the fixture's: this is the approval path a person actually sees.
		const outside = join(tmpdir(), "mu-rehearsal-write-probe.txt");
		const provider = await startProvider((index) =>
			index === 1 ? { tool: "write", args: { path: outside, content: "hello from the stub" } } : { text: "Understood, I did not write it." },
		);
		const profile = await launchedWith(provider.port);
		const { page } = profile;
		try {
			await firstRun(page);
			await page.locator('[data-testid="composer"]').fill("write a file");
			await page.locator('[data-testid="send"]').click();

			const card = page.locator('[data-testid="approval"]');
			await expect(card).toBeVisible({ timeout: 120_000 });
			await expect(card).toContainText("outside the project");
			await card.locator('[data-testid="approval-option"]', { hasText: "Don't allow" }).click();

			await expect(page.locator('.message[data-role="assistant"] .text').last()).toHaveText("Understood, I did not write it.", {
				timeout: 120_000,
			});
			await expect(card).toHaveCount(0);
			// The tool row says it failed, and the file is not there.
			await expect(page.locator('.message[data-role="tool"] .text')).toContainText("(error)");
			expect(existsSync(outside), "the denied write happened anyway").toBe(false);
			expect(provider.requests.length, "the model never heard the denial").toBe(2);
		} finally {
			await profile.close();
			provider.close();
			rmSync(outside, { force: true });
		}
	});

	test("allows a write outside the project when told to, and the file appears", async () => {
		const outside = join(tmpdir(), "mu-rehearsal-write-allowed.txt");
		const provider = await startProvider((index) =>
			index === 1 ? { tool: "write", args: { path: outside, content: "written after approval" } } : { text: "Written." },
		);
		const profile = await launchedWith(provider.port);
		const { page } = profile;
		try {
			await firstRun(page);
			await page.locator('[data-testid="composer"]').fill("write a file");
			await page.locator('[data-testid="send"]').click();

			const card = page.locator('[data-testid="approval"]');
			await expect(card).toBeVisible({ timeout: 120_000 });
			await card.locator('[data-testid="approval-option"]', { hasText: "Allow once" }).click();

			await expect(page.locator('.message[data-role="assistant"] .text').last()).toHaveText("Written.", { timeout: 120_000 });
			await expect(card).toHaveCount(0);
			await expect(page.locator('.message[data-role="tool"] .text')).toContainText("(ok)");
			expect(existsSync(outside)).toBe(true);
			expect(readFileSync(outside, "utf8")).toContain("written after approval");
			expect(provider.requests.length, "the model never heard the result").toBe(2);
		} finally {
			await profile.close();
			provider.close();
			rmSync(outside, { force: true });
		}
	});

	test("renders the real harness's settings manifest, and switches language", async () => {
		// The fixture manifest has a handful of features in one language; the real one has 36 features and 13 languages.
		// A build that only renders its own idea of a settings file fails here rather than on a user's machine.
		const provider = await startProvider(() => ({ text: "ok" }));
		const profile = await launchedWith(provider.port);
		const { page } = profile;
		try {
			await firstRun(page);
			await page.locator('[data-testid="nav-settings"]').click();
			await expect(page.locator('[data-testid="settings"]')).toBeVisible({ timeout: 60_000 });
			await expect(page.locator('[data-testid="settings-error"]')).toHaveCount(0);
			await expect(page.locator('[data-testid="settings-problems"]')).toHaveCount(0);
			expect(await page.locator('[data-testid="settings-language"] option').count()).toBe(13);
			expect(await page.locator('[data-testid="settings-features"] .feature').count()).toBeGreaterThan(20);
			await expect(page.locator('[data-testid="settings-features"]')).toContainText("admission");

			await page.locator('[data-testid="settings-language"]').selectOption("zh");
			// The shell's own words and the manifest's words both change.
			await expect(page.locator('[data-testid="settings-features"]')).toContainText("消息预判");
			await expect(page.locator('[data-testid="settings-error"]')).toHaveCount(0);

			// A language the shell has no words for: the manifest text is still translated and the shell's own chrome
			// falls back to English — "the useful half", as the module says.
			await page.locator('[data-testid="settings-language"]').selectOption("ja-JP");
			await expect(page.locator('[data-testid="settings-features"]')).toContainText(/[\u3040-\u30ff]/);
			await expect(page.locator('[data-testid="nav-conversation"]')).toHaveText("Conversation");
			await expect(page.locator('[data-testid="settings-error"]')).toHaveCount(0);
		} finally {
			await profile.close();
			provider.close();
		}
	});

	test("saves a real manifest option to mu.json and keeps it across an agent restart", async () => {
		// The settings screen's own e2e uses the fixture manifest; this one writes the kernel's real document and reads
		// it back after the agent restarts, which is the path a person actually takes.
		const provider = await startProvider(() => ({ text: "ok" }));
		const profile = await launchedWith(provider.port);
		const { page } = profile;
		try {
			await firstRun(page);
			await page.locator('[data-testid="nav-settings"]').click();
			await expect(page.locator('[data-testid="settings"]')).toBeVisible({ timeout: 60_000 });

			const box = page.locator('[data-option] input[type="checkbox"]').filter({ visible: true }).first();
			const option = await box.evaluate((node) => node.closest("[data-option]")?.getAttribute("data-option") ?? "");
			if (option === "") throw new Error("no manifest option is on screen");
			const parts = option.split(".");
			const feature = parts[0] ?? "";
			const key = parts.slice(1).join(".");
			const before = await box.isChecked();
			await box.click();
			await expect(page.locator('[data-testid="settings-saved"]')).toContainText("Restart", { timeout: 30_000 });

			const settingsFile = join(profile.home, ".spec.ai.jev", "agent", "mu.json");
			const stored = (): unknown => {
				try {
					const document = JSON.parse(readFileSync(settingsFile, "utf8")) as { features?: Record<string, Record<string, unknown>> };
					return document.features?.[feature]?.[key];
				} catch {
					return undefined;
				}
			};
			await expect.poll(stored).toBe(!before);

			await page.locator('[data-testid="restart"]').click();
			// The status chip is the only `.chip` on the conversation page, but the settings page also has the "saved"
			// chip; wait for the restarting one to go away rather than matching both.
			await expect(page.locator(".chip-restarting")).toHaveCount(0, { timeout: 120_000 });
			await page.locator('[data-testid="nav-settings"]').click();
			await expect(page.locator(`[data-option="${option}"] input[type="checkbox"]`)).toBeChecked({ checked: !before, timeout: 30_000 });
		} finally {
			await profile.close();
			provider.close();
		}
	});

	test("does not show the conversation twice after visiting the settings", async () => {
		// The conversation screen asks the harness for its history every time it is entered. Coming back from the
		// settings used to add those messages again, next to the live rows that already carry them.
		const provider = await startProvider(() => ({ text: "once" }));
		const profile = await launchedWith(provider.port);
		const { page } = profile;
		try {
			await firstRun(page);
			await page.locator('[data-testid="composer"]').fill("say it once");
			await page.locator('[data-testid="send"]').click();
			await expect(page.locator('.message[data-role="assistant"] .text').last()).toHaveText("once", { timeout: 120_000 });
			await expect(page.locator('.message[data-role="user"] .text')).toHaveCount(1);

			await page.locator('[data-testid="nav-settings"]').click();
			await expect(page.locator('[data-testid="settings"]')).toBeVisible({ timeout: 60_000 });
			await page.locator('[data-testid="nav-conversation"]').click();
			await expect(page.locator('[data-testid="composer"]')).toBeVisible({ timeout: 60_000 });

			await expect(page.locator('.message[data-role="user"] .text')).toHaveCount(1);
			await expect(page.locator('.message[data-role="assistant"] .text')).toHaveCount(1);
		} finally {
			await profile.close();
			provider.close();
		}
	});

	test("grants judge consent against the real harness and records it", async () => {
		// The grant goes through the harness's own command (`mu judge consent accept`), not through a fixture: what is
		// asserted is the file the kernel and the shell both read afterwards.
		const provider = await startProvider(() => ({ text: "ok" }));
		const profile = await launchedWith(provider.port);
		const { page } = profile;
		try {
			await page.locator('[data-testid="first-run"]').waitFor({ state: "visible", timeout: 90_000 });
			await page.locator('[data-language="en"]').click();
			await page.locator('[data-testid="first-run-next"]').click();

			const consent = join(profile.home, ".spec.ai.jev", "agent", "consent.json");
			expect(existsSync(consent), "consent was recorded before anyone granted it").toBe(false);
			await page.locator('[data-testid="first-run-grant"]').click();
			await expect
				.poll(
					() => {
						try {
							return (JSON.parse(readFileSync(consent, "utf8")) as { judgeId?: string }).judgeId;
						} catch {
							return undefined;
						}
					},
					{ timeout: 60_000 },
				)
				.toBe("jev");
			await expect(page.locator('[data-testid="first-run-model"]')).toBeVisible({ timeout: 60_000 });
		} finally {
			await profile.close();
			provider.close();
		}
	});

	test("revokes judge consent from the settings screen, against the real harness", async () => {
		const provider = await startProvider(() => ({ text: "ok" }));
		const profile = await launchedWith(provider.port);
		const { page } = profile;
		try {
			await page.locator('[data-testid="first-run"]').waitFor({ state: "visible", timeout: 90_000 });
			await page.locator('[data-language="en"]').click();
			await page.locator('[data-testid="first-run-next"]').click();
			await page.locator('[data-testid="first-run-grant"]').click();
			const consent = join(profile.home, ".spec.ai.jev", "agent", "consent.json");
			await expect.poll(() => existsSync(consent), { timeout: 60_000 }).toBe(true);

			await expect(page.locator('[data-testid="first-run-model"]')).toBeVisible({ timeout: 60_000 });
			await page.locator('[data-testid="first-run-model"] input[value="stub/stub-1"]').click();
			await page.locator('[data-testid="first-run-finish"]').click();
			await expect(page.locator(".chip")).toContainText("running", { timeout: 120_000 });

			await page.locator('[data-testid="nav-settings"]').click();
			await expect(page.locator('[data-testid="settings"]')).toBeVisible({ timeout: 60_000 });
			await expect(page.locator('[data-testid="consent-state"]')).toContainText("Consent granted", { timeout: 30_000 });
			await page.locator('[data-testid="consent-revoke"]').click();
			await expect.poll(() => existsSync(consent), { timeout: 60_000 }).toBe(false);
			await expect(page.locator('[data-testid="consent-state"]')).toContainText("No consent", { timeout: 30_000 });
		} finally {
			await profile.close();
			provider.close();
		}
	});

	test("runs a tool the harness asked for, as one row, and answers with its result", async () => {
		const provider = await startProvider((index) =>
			index === 1 ? { tool: "bash", args: { command: "echo hello-from-tool" } } : { text: "The tool said hello." },
		);
		const profile = await launchedWith(provider.port);
		const { page } = profile;
		try {
			await firstRun(page);
			await page.locator('[data-testid="composer"]').fill("run a command");
			await page.locator('[data-testid="send"]').click();

			// A harmless command is allowed; if a card does appear, answer it the way a person would.
			await page.waitForTimeout(2000);
			if ((await page.locator('[data-testid="approval"]').count()) > 0) {
				await page.locator('[data-testid="approval-allow"]').click();
			}

			await expect(page.locator('.message[data-role="assistant"] .text').last()).toHaveText("The tool said hello.", {
				timeout: 120_000,
			});
			// One row for the tool call: name and status, not the raw result as two more messages.
			const tools = page.locator('.message[data-role="tool"]');
			await expect(tools).toHaveCount(1);
			await expect(tools.first()).toContainText("bash");
			await expect(tools.first().locator(".text")).toContainText("echo hello-from-tool");
			await expect(tools.first().locator(".text")).toContainText("(ok)");
			// The raw tool output is not a row of its own.
			const texts = await page.locator(".message .text").allTextContents();
			expect(texts.some((text) => text.trim() === "hello-from-tool")).toBe(false);
			expect(provider.requests.length, "the harness did not come back with the tool result").toBe(2);
			expect(sessionTextFiles(profile.home).some((file) => readFileSync(file, "utf8").includes("hello-from-tool"))).toBe(true);
		} finally {
			await profile.close();
			provider.close();
		}
	});
});
