// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { expect, test } from "@playwright/test";
import { completeFirstRun, launchApp } from "./helpers/app.ts";

/**
 * The conversation: text that arrives in pieces, a stop that takes effect, and a conversation that keeps its shape
 * when the harness says something this build does not know.
 *
 * The fixture harness scripts the events ("stream" is its default answer, "notice" sends a presentation-coded line),
 * so what is asserted here is the renderer's behaviour, not a model's.
 */

test.describe("conversation", () => {
	test("sends an attached image with the prompt", async () => {
		const profile = await launchApp();
		const { page } = profile;
		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			// A 1x1 PNG: the fixture answers with how many images arrived and what type they were.
			const png = Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
				"base64",
			);
			await page.locator('[data-testid="attach-input"]').setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: png });

			await expect(page.locator('[data-testid="attachments"] img')).toHaveCount(1);
			await page.locator('[data-testid="composer"]').fill("what is this");
			await page.locator('[data-testid="send"]').click();

			await expect(page.locator('.message[data-role="assistant"] .text').last()).toHaveText("images: 1 image/png", {
				timeout: 30_000,
			});
			// Sent means gone: the chip and the draft both clear.
			await expect(page.locator('[data-testid="attachments"]')).toHaveCount(0);
			await expect(page.locator('[data-testid="composer"]')).toHaveValue("");
		} finally {
			await profile.close();
		}
	});

	test("refuses a file that is not an image the providers take", async () => {
		const profile = await launchApp();
		const { page } = profile;
		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			await page
				.locator('[data-testid="attach-input"]')
				.setInputFiles({ name: "notes.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });

			await expect(page.locator('[data-testid="error"]')).toContainText(/PNG, JPEG, WebP and GIF/);
			await expect(page.locator('[data-testid="attachments"]')).toHaveCount(0);
		} finally {
			await profile.close();
		}
	});

	test("shows an answer as it arrives, and stops when asked", async () => {
		const profile = await launchApp();
		const { page } = profile;
		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			await page.locator('[data-testid="composer"]').fill("stream");
			await page.locator('[data-testid="send"]').click();

			// The answer arrives in four deltas and is one message by the end — after the session's own history.
			await expect(page.locator('.message[data-role="assistant"] .text').last()).toHaveText("Hello from the fixture", {
				timeout: 30_000,
			});
			await expect(page.locator('.message[data-role="assistant"] .text')).toHaveCount(2);
			await expect(page.locator('[data-testid="streaming"]')).toHaveCount(0);
			await expect(page.locator('[data-testid="composer"]')).toBeEnabled();

			// Stop is live while a turn runs and takes effect: the harness answers an abort with its own end.
			await expect(page.locator('[data-testid="stop"]')).toBeEnabled();
			await page.locator('[data-testid="stop"]').click();
			await expect(page.locator(".chip")).toContainText("running");
			await expect(page.locator('[data-testid="composer"]')).toBeEnabled();
		} finally {
			await profile.close();
		}
	});

	test("keeps a long conversation to a bounded number of rows", async () => {
		// 250 messages in the session; the window is allowed to mount 200 of them. A conversation of two thousand is
		// then the same amount of DOM as one of two hundred.
		const profile = await launchApp({ env: { SPEC_AI_JEV_FIXTURE_HISTORY: "250" } });
		const { page } = profile;
		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });
			await expect(page.locator(".message")).toHaveCount(200, { timeout: 30_000 });
			await expect(page.locator(".message .text").first()).toHaveText("history message 51");

			// A live turn pushes the oldest visible row out and keeps the count at the limit.
			await page.locator('[data-testid="composer"]').fill("stream");
			await page.locator('[data-testid="send"]').click();
			await expect(page.locator('.message[data-role="assistant"] .text').last()).toHaveText("Hello from the fixture", {
				timeout: 30_000,
			});
			await expect(page.locator(".message")).toHaveCount(200);
		} finally {
			await profile.close();
		}
	});

	test("keeps a coded notice from a newer harness, in English, without crashing", async () => {
		const profile = await launchApp();
		const { page } = profile;
		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			await page.locator('[data-testid="composer"]').fill("notice");
			await page.locator('[data-testid="send"]').click();

			// `browser.run.open_failed` is not in this build's table: the sentence it came with is shown, filled in.
			const notice = page.locator('[data-testid="notices"] p[data-code="browser.run.open_failed"]');
			await expect(notice).toBeVisible({ timeout: 30_000 });
			await expect(notice).toHaveText("could not open https://x.test in the browser");
			await expect(page.locator('.message[data-role="assistant"] .text').last()).toHaveText("Noted.");
		} finally {
			await profile.close();
		}
	});

	test("opens into the session's existing conversation", async () => {
		const profile = await launchApp();
		const { page } = profile;
		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			// The fixture's session already has two messages; a chat that forgets them on every window open is not one.
			await expect(page.locator('.message[data-role="user"] .text')).toHaveText(["earlier question"], { timeout: 20_000 });
			await expect(page.locator('.message[data-role="assistant"] .text')).toHaveText(["earlier answer"]);

			// A live turn lands after the history rather than replacing it.
			await page.locator('[data-testid="composer"]').fill("stream");
			await page.locator('[data-testid="send"]').click();
			await expect(page.locator('.message[data-role="assistant"] .text')).toHaveText(["earlier answer", "Hello from the fixture"]);
		} finally {
			await profile.close();
		}
	});

	test("renders the answer's Markdown instead of its backticks", async () => {
		const profile = await launchApp();
		const { page } = profile;
		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			await page.locator('[data-testid="composer"]').fill("markdown");
			await page.locator('[data-testid="send"]').click();

			const answer = page.locator('.message[data-role="assistant"]').last();
			// A heading becomes a heading, inline code becomes <code>, and the fence becomes a preformatted block.
			await expect(answer.locator("h2")).toHaveText("Result", { timeout: 30_000 });
			await expect(answer.locator("p code")).toHaveText("npm test");
			await expect(answer.locator("pre.code code")).toHaveText("npm test -- --run");
			await expect(answer.locator("pre.code code")).toHaveAttribute("data-language", "sh");
			// And the source backticks are gone from the rendered text.
			await expect(answer).not.toContainText("```");
		} finally {
			await profile.close();
		}
	});

	test("starts a new conversation when asked", async () => {
		const profile = await launchApp();
		const { page } = profile;
		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });
			await expect(page.locator('.message[data-role="user"] .text')).toHaveText(["earlier question"], { timeout: 20_000 });

			await page.locator('[data-testid="new-conversation"]').click();

			// The session's own messages are gone, and the next answer is the only thing on screen.
			await expect(page.locator('.message[data-role="user"] .text')).toHaveCount(0);
			await expect(page.locator(".message")).toHaveCount(0);
			await page.locator('[data-testid="composer"]').fill("stream");
			await page.locator('[data-testid="send"]').click();
			await expect(page.locator('.message[data-role="assistant"] .text')).toHaveText(["Hello from the fixture"], { timeout: 30_000 });
		} finally {
			await profile.close();
		}
	});

	test("the window survives a second turn and keeps both answers", async () => {
		const profile = await launchApp();
		const { page } = profile;
		try {
			await completeFirstRun(page);
			await expect(page.locator(".chip")).toContainText("running", { timeout: 60_000 });

			for (const message of ["first", "second"]) {
				await page.locator('[data-testid="composer"]').fill(message);
				await page.locator('[data-testid="send"]').click();
				await expect(page.locator('.message[data-role="assistant"] .text').last()).toHaveText("Hello from the fixture");
			}

			await expect(page.locator('.message[data-role="user"] .text')).toHaveText(["earlier question", "first", "second"]);
			await expect(page.locator('.message[data-role="assistant"] .text')).toHaveCount(3);
		} finally {
			await profile.close();
		}
	});
});
