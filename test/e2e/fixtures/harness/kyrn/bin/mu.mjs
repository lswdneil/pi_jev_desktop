// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * A harness that answers the JSONL protocol without an agent behind it.
 *
 * The end-to-end tests need a harness whose manifest and events they control, without a model, a key, or a network.
 * This is the smallest thing that behaves like `mu`: one JSON command per line in, answers and events out. It also
 * implements the two subcommands the shell runs as a command line — `judge consent accept|revoke` and
 * `ledger --json` — so those paths are exercised against a child process rather than mocked.
 *
 * The prompt decides which scripted conversation runs: "stream" (default), "danger" (an approval), "write" (a tool
 * that touches a file), "notice" (a presentation-coded line), "slow" (streaming that a stop can interrupt).
 *
 * Not shipped, not imported by the app: `MU_ROOT` points at this folder, so the shell starts it the same way it starts
 * a real checkout.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const agentDir = process.env.MU_AGENT_DIR || join(homedir(), ".mu", "agent");
const consentFile = join(agentDir, "consent.json");

/** Crash on startup on purpose: the end-to-end test for "the agent died and the window says why". */
if (process.env.MU_FIXTURE_CRASH_ON_START === "1") {
	process.stderr.write("fixture: crashing on purpose (MU_FIXTURE_CRASH_ON_START=1)\n");
	process.exit(3);
}

if (argv[0] === "judge" && argv[1] === "consent") {
	const action = argv[2];
	if (action === "accept") {
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(
			consentFile,
			`${JSON.stringify(
				{ judgeId: "jev", consentVersion: 1, agreedAt: new Date().toISOString(), scope: "remote-judge" },
				null,
				2,
			)}\n`,
			{ mode: 0o600 },
		);
		process.stdout.write("the default judge: consented\n");
		process.exit(0);
	}
	if (action === "revoke") {
		rmSync(consentFile, { force: true });
		process.stdout.write("the default judge: consent removed\n");
		process.exit(0);
	}
	process.stderr.write(`unknown consent action: ${action}\n`);
	process.exit(1);
}

// `mu ledger --json`: one JSON object per decision, the way kyrn-ledger prints them.
if (argv[0] === "ledger") {
	if (!argv.includes("--json")) {
		process.stdout.write("2026-10-18 10:00  [fixture active v1] turn.continue\n");
		process.exit(0);
	}
	const records = [
		{
			id: "ledger-1",
			specId: "turn.continue",
			mode: "active",
			providerId: "jev",
			source: "judge",
			userMessage: "first ask",
		},
		{
			id: "ledger-2",
			specId: "tool.admission",
			mode: "shadow",
			providerId: "jev",
			source: "judge",
			userMessage: "second ask",
		},
	];
	for (const record of records) process.stdout.write(`${JSON.stringify(record)}\n`);
	process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), "mu-fixture-agent-"));
/** The model the last `set_model` chose, so `get_state` can report it the way the real agent does. */
let chosenModel;
/** Which scripted conversation is waiting on an answer from the window. */
let pendingApproval;
/** Whether the fixture's session still holds its earlier messages; `new_session` clears them. */
let hasSession = true;

function emit(event) {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}

function answer(id, command, data) {
	const response = { type: "response", id, command, success: true };
	if (data !== undefined) response.data = data;
	emit(response);
}

function assistant(text) {
	return { role: "assistant", content: [{ type: "text", text }] };
}

function delta(text) {
	return {
		type: "message_update",
		usage: {},
		assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text },
	};
}

/**
 * The messages a session that continues answers with: the default three, or `MU_FIXTURE_HISTORY=<n>` alternating rows
 * so a test can hand the window a conversation far longer than the number of rows it is allowed to mount.
 */
function historyMessages() {
	const count = Number.parseInt(process.env.MU_FIXTURE_HISTORY ?? "", 10);
	if (!Number.isFinite(count) || count <= 0) {
		return [
			{ role: "user", content: [{ type: "text", text: "earlier question" }] },
			{ role: "assistant", content: [{ type: "text", text: "earlier answer" }] },
			{ role: "toolResult", toolName: "write", content: [] },
		];
	}
	return Array.from({ length: count }, (_, index) =>
		index % 2 === 0
			? { role: "user", content: [{ type: "text", text: `history message ${index + 1}` }] }
			: { role: "assistant", content: [{ type: "text", text: `history answer ${index + 1}` }] },
	);
}

function finish(text) {
	emit({ type: "message_end", message: assistant(text) });
	emit({ type: "agent_end", messages: [], willRetry: false });
	emit({ type: "agent_settled" });
}

function runPrompt(text) {
	emit({ type: "agent_start" });
	emit({ type: "turn_start" });
	// The real harness sends the user's own message back on the stream; a client that does not hear it cannot show it.
	emit({ type: "message_start", message: { role: "user", content: [{ type: "text", text }] } });

	if (text.includes("danger")) {
		emit({
			type: "extension_ui_request",
			id: "ui-danger",
			method: "confirm",
			title: "Run rm -rf build?",
			message: "This deletes the build folder.",
		});
		pendingApproval = "danger";
		return;
	}

	if (text.includes("write")) {
		emit({ type: "message_start", message: assistant("") });
		emit(delta("Writing the file."));
		emit({ type: "message_end", message: assistant("Writing the file.") });
		emit({ type: "tool_execution_start", toolCallId: "call-write", toolName: "write", args: { path: "src/app.ts" } });
		emit({ type: "tool_execution_end", toolCallId: "call-write", result: {}, isError: false });
		finish("Done: src/app.ts");
		return;
	}

	if (text.includes("notice")) {
		emit({
			type: "extension_ui_request",
			id: "notice-1",
			method: "notify",
			code: "browser.run.open_failed",
			reason: "could not open {url} in the browser",
			params: { url: "https://x.test" },
		});
		finish("Noted.");
		return;
	}

	if (text.includes("markdown")) {
		const answer = "## Result\n\nUse `npm test`.\n\n```sh\nnpm test -- --run\n```";
		emit({ type: "message_start", message: assistant("") });
		for (const chunk of ["## Result\n\nUse `npm test`.", "\n\n```sh\nnpm test -- --run\n```"]) emit(delta(chunk));
		finish(answer);
		return;
	}

	emit({ type: "message_start", message: assistant("") });
	for (const chunk of ["Hel", "lo ", "from ", "the fixture"]) emit(delta(chunk));
	finish("Hello from the fixture");
}

const reader = createInterface({ input: process.stdin });
reader.on("line", (line) => {
	let command;
	try {
		command = JSON.parse(line);
	} catch {
		return;
	}

	if (command.type === "extension_ui_response" && pendingApproval === "danger") {
		const allowed = command.confirmed === true;
		pendingApproval = undefined;
		emit({ type: "message_start", message: assistant("") });
		emit(delta(allowed ? "Allowed, running it." : "The user declined."));
		emit({
			type: "tool_execution_start",
			toolCallId: "call-danger",
			toolName: "bash",
			args: { command: "rm -rf build" },
		});
		if (!allowed)
			emit({ type: "tool_execution_end", toolCallId: "call-danger", result: { denied: true }, isError: true });
		else emit({ type: "tool_execution_end", toolCallId: "call-danger", result: {}, isError: false });
		finish(`decision: ${allowed ? "allowed" : "declined"}`);
		return;
	}

	switch (command.type) {
		case "new_session":
			if (process.env.MU_FIXTURE_CANCEL_NEW_SESSION === "1") {
				answer(command.id, "new_session", { cancelled: true });
				break;
			}
			// A fresh session: the history is gone, which is exactly what "new conversation" has to mean on screen.
			hasSession = false;
			answer(command.id, "new_session", { cancelled: false });
			break;
		case "get_messages":
			// What a session that already exists answers: the window opening into it must show this conversation.
			// `MU_FIXTURE_HISTORY=<n>` makes it a long one, to check that the window mounts a bounded number of rows.
			answer(command.id, "get_messages", { messages: hasSession ? historyMessages() : [] });
			break;
		case "get_state":
			answer(command.id, "get_state", {
				...(chosenModel === undefined ? {} : { model: chosenModel }),
				thinkingLevel: "medium",
				isStreaming: false,
				isCompacting: false,
				steeringMode: "all",
				followUpMode: "all",
				sessionId: `fixture-${scratch.length}`,
				autoCompactionEnabled: true,
				messageCount: 0,
				pendingMessageCount: 0,
			});
			break;
		case "switch_session":
			// The fixture has one scripted conversation; switching means it now has a session to answer from.
			hasSession = true;
			answer(command.id, "switch_session", { cancelled: false });
			break;
		case "set_session_name":
			answer(command.id, "set_session_name", {});
			break;
		case "get_available_models":
			answer(command.id, "get_available_models", {
				models: [{ provider: "fixture", id: "model-a", contextWindow: 1000 }],
			});
			break;
		case "set_model":
			chosenModel = { provider: command.provider, id: command.modelId, contextWindow: 1000 };
			emit({ type: "model_changed", provider: command.provider, modelId: command.modelId });
			answer(command.id, "set_model", chosenModel);
			break;
		case "prompt":
			answer(command.id, "prompt", { disposition: "started" });
			runPrompt(String(command.message ?? ""));
			break;
		case "abort":
			answer(command.id, "abort");
			finish("(stopped)");
			break;
		default:
			emit({
				type: "response",
				id: command.id,
				command: String(command.type),
				success: false,
				error: "the fixture does not implement this command",
			});
	}
});

process.on("SIGTERM", () => process.exit(0));
