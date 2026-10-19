// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The agent's lifetime: start it, keep the tail of its log, restart it a few times when it dies, give up loudly.
 *
 * The old shell handed the process to `RpcClient`, which restarted nothing and wrote the child's stderr into the
 * app's own log, so a wedged agent looked like a quiet app. Here every exit is a state the window can render, and a
 * failure carries where mu should have been, which is the only part of the message a user can act on.
 */

import type { AgentEvent, HarnessStatus, ModelChoice, PromptResult, SessionSnapshot, UiAnswer } from "../shared/api.ts";
import { type HistoryMessage, messageText } from "../shared/conversation.ts";
import type { RpcSessionState } from "../shared/pi-protocol.ts";
import type { Harness } from "./harness.ts";
import { type AgentLaunch, type SpawnAgent, RpcConnection } from "./rpc.ts";

/** 0.5 s, 1 s, 2 s: short enough that a transient failure is invisible, long enough not to spin. */
export const DEFAULT_BACKOFF_MS: readonly number[] = [500, 1_000, 2_000];
export const DEFAULT_RETRIES = 3;
/** How long a fresh process must stay alive before it counts as running. */
const READY_GRACE_MS = 300;
const STDERR_LINES = 40;
const STDERR_LINE_CHARS = 400;

export class NotRunningError extends Error {
	constructor() {
		super("the agent is not running");
		this.name = "NotRunningError";
	}
}

export interface SupervisorOptions {
	/** Where mu is, if it is anywhere. Called on every attempt, so fixing the path and pressing retry works. */
	readonly locate: () => Harness | undefined;
	readonly launchOf: (harness: Harness) => AgentLaunch;
	/** Where mu should have been, for the failure screen. */
	readonly expected: () => { readonly root: string; readonly layout: "repo" | "package" };
	readonly spawn: SpawnAgent;
	readonly sleep?: (ms: number) => Promise<void>;
	readonly retries?: number;
	readonly backoffMs?: readonly number[];
	readonly readyGraceMs?: number;
	readonly onChange?: (status: HarnessStatus) => void;
	readonly onEvent?: (event: AgentEvent) => void;
}

export class AgentSupervisor {
	private readonly options: SupervisorOptions;
	private readonly retries: number;
	private readonly backoffMs: readonly number[];
	private readonly readyGraceMs: number;
	private status: HarnessStatus = { state: "stopped" };
	private connection: RpcConnection | undefined;
	private attempts = 0;
	private stderr: string[] = [];
	private stopped = false;
	private starting: Promise<HarnessStatus> | undefined;
	private generation = 0;

	constructor(options: SupervisorOptions) {
		this.options = options;
		this.retries = options.retries ?? DEFAULT_RETRIES;
		this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
		this.readyGraceMs = options.readyGraceMs ?? READY_GRACE_MS;
	}

	getStatus(): HarnessStatus {
		return this.status;
	}

	/** Start, or return the status that is already there. Concurrent calls share one attempt. */
	async start(): Promise<HarnessStatus> {
		if (this.status.state === "running") return this.status;
		if (this.starting) return this.starting;
		this.stopped = false;
		this.attempts = 0;
		const generation = ++this.generation;
		const starting = this.attemptStart(generation).finally(() => {
			if (this.starting === starting) this.starting = undefined;
		});
		this.starting = starting;
		return starting;
	}

	/** Stop and start again, forgetting the failures that led here. */
	async restart(): Promise<HarnessStatus> {
		await this.stop();
		return this.start();
	}

	async stop(): Promise<void> {
		this.stopped = true;
		this.generation++;
		this.starting = undefined;
		const connection = this.connection;
		this.connection = undefined;
		connection?.dispose();
		this.setStatus({ state: "stopped" });
	}

	async prompt(message: string): Promise<PromptResult> {
		const text = message.trim();
		if (text === "") throw new Error("a prompt cannot be empty");
		const response = await this.requireConnection().request({ type: "prompt", message: text });
		if (!response.success) throw new Error(response.error);
		if (response.command !== "prompt") throw new Error(`the agent answered a prompt with ${response.command}`);
		return { disposition: (response.data as { disposition: PromptResult["disposition"] }).disposition };
	}

	async abort(): Promise<void> {
		const response = await this.requireConnection().request({ type: "abort" });
		if (!response.success) throw new Error(response.error);
	}

	async snapshot(): Promise<SessionSnapshot> {
		const response = await this.requireConnection().request({ type: "get_state" });
		if (!response.success) throw new Error(response.error);
		if (response.command !== "get_state") throw new Error(`the agent answered get_state with ${response.command}`);
		const state = response.data as RpcSessionState;
		const model = state.model === undefined ? undefined : `${state.model.provider}/${state.model.id}`;
		return {
			sessionId: state.sessionId,
			...(state.sessionFile === undefined ? {} : { sessionFile: state.sessionFile }),
			...(state.sessionName === undefined ? {} : { sessionName: state.sessionName }),
			model,
			thinkingLevel: state.thinkingLevel,
			isStreaming: state.isStreaming,
			messageCount: state.messageCount,
		};
	}

	private requireConnection(): RpcConnection {
		if (this.connection === undefined || this.status.state !== "running") throw new NotRunningError();
		return this.connection;
	}

	/** The session's existing messages, so a window that opens into a running session shows the conversation. */
	async history(): Promise<HistoryMessage[]> {
		const response = await this.requireConnection().request({ type: "get_messages" });
		if (!response.success) throw new Error(response.error);
		if (response.command !== "get_messages")
			throw new Error(`the agent answered get_messages with ${response.command}`);
		const messages: HistoryMessage[] = [];
		for (const message of (response.data as { messages: readonly unknown[] }).messages) {
			const role = (message as { role?: unknown }).role;
			if (role !== "user" && role !== "assistant") continue;
			messages.push({ role, text: messageText(message) });
		}
		return messages;
	}

	/** A fresh session: the harness keeps the old one, this window starts the next one. */
	async newSession(): Promise<void> {
		const response = await this.requireConnection().request({ type: "new_session" });
		if (!response.success) throw new Error(response.error);
		if (response.command !== "new_session") throw new Error(`the agent answered new_session with ${response.command}`);
		if ((response.data as { cancelled: boolean }).cancelled)
			throw new Error("the new conversation was cancelled; the current session is unchanged");
	}

	/** Switch the live agent to a saved session file; the caller reloads history afterwards. */
	async switchSession(sessionPath: string): Promise<void> {
		const response = await this.requireConnection().request({ type: "switch_session", sessionPath });
		if (!response.success) throw new Error(response.error);
		if (response.command !== "switch_session") {
			throw new Error(`the agent answered switch_session with ${response.command}`);
		}
		if ((response.data as { cancelled: boolean }).cancelled) {
			throw new Error("the session switch was cancelled; the current session is unchanged");
		}
	}

	/** Name the current session; the file keeps the name as a session_info entry. */
	async renameSession(name: string): Promise<void> {
		const trimmed = name.trim();
		if (trimmed === "") throw new Error("a session name cannot be empty");
		const response = await this.requireConnection().request({ type: "set_session_name", name: trimmed });
		if (!response.success) throw new Error(response.error);
		if (response.command !== "set_session_name") {
			throw new Error(`the agent answered set_session_name with ${response.command}`);
		}
	}

	/** The models the harness can use, for the first-run screen. Listing them needs no key; running one does. */
	async models(): Promise<ModelChoice[]> {
		const response = await this.requireConnection().request({ type: "get_available_models" });
		if (!response.success) throw new Error(response.error);
		if (response.command !== "get_available_models") {
			throw new Error(`the agent answered get_available_models with ${response.command}`);
		}
		return (response.data as { models: readonly { provider: string; id: string }[] }).models.map((model) => ({
			provider: model.provider,
			id: model.id,
		}));
	}

	async setModel(provider: string, modelId: string): Promise<void> {
		const response = await this.requireConnection().request({ type: "set_model", provider, modelId });
		if (!response.success) throw new Error(response.error);
	}

	/** Answer a request the agent is blocked on. Nothing comes back: the agent continues, or it does not. */
	respond(answer: UiAnswer): void {
		const connection = this.requireConnection();
		const id = answer.id;
		if (answer.cancelled === true) connection.send({ type: "extension_ui_response", id, cancelled: true });
		else if (answer.confirmed !== undefined)
			connection.send({ type: "extension_ui_response", id, confirmed: answer.confirmed });
		else connection.send({ type: "extension_ui_response", id, value: answer.value ?? "" });
	}

	/** One spawn, one wait for the grace period, then either running or a death to handle. */
	private async attemptStart(generation: number): Promise<HarnessStatus> {
		if (this.stopped || generation !== this.generation) return this.status;
		const harness = this.options.locate();
		if (harness === undefined) return this.fail("mu was not found where this build looks for it");

		this.setStatus({ state: "starting" });
		let process: ReturnType<SpawnAgent>;
		try {
			process = this.options.spawn(this.options.launchOf(harness));
		} catch (error) {
			return this.onDeath(
				`the agent could not be started: ${error instanceof Error ? error.message : String(error)}`,
				generation,
			);
		}
		const connection = new RpcConnection(process, {
			onEvent: (event) => {
				if (generation === this.generation && !this.stopped) this.options.onEvent?.(event);
			},
		});
		this.connection = connection;
		process.onStderr((chunk) => this.recordStderr(chunk));

		// This attempt's death, as a value. Exit and error both count, and only the first one does.
		let reported = false;
		let notify: (reason: string) => void = () => {};
		const death = new Promise<string>((resolve) => {
			notify = resolve;
		});
		const report = (reason: string): void => {
			if (reported) return;
			reported = true;
			notify(reason);
		};
		process.onExit((code, signal) => report(this.exitReason(code, signal)));
		process.onError((error) => report(`the agent could not be started: ${error.message}`));

		const died = await Promise.race([death, this.delay(this.readyGraceMs).then(() => undefined)]);
		if (this.stopped || generation !== this.generation) return this.status;
		if (died !== undefined) return this.onDeath(died, generation);

		this.setStatus({ state: "running", root: harness.root, layout: harness.layout, pid: process.pid });
		// The race above did not consume the death: a later crash still has to reach the window.
		void death.then((reason) => this.onDeath(reason, generation));
		return this.status;
	}

	private async onDeath(reason: string, generation: number): Promise<HarnessStatus> {
		// A replaced process can exit after its successor starts; it must not clear the new connection.
		if (this.stopped || generation !== this.generation) return this.status;
		this.connection = undefined;

		const attempt = this.attempts + 1;
		if (attempt > this.retries) return this.fail(reason);
		this.attempts = attempt;
		const delayMs = this.backoffMs[Math.min(attempt - 1, this.backoffMs.length - 1)] ?? 1_000;
		this.setStatus({ state: "restarting", attempt, of: this.retries, delayMs, reason });
		await this.delay(delayMs);
		if (this.stopped || generation !== this.generation) return this.status;
		return this.attemptStart(generation);
	}

	private exitReason(code: number | null, signal: NodeJS.Signals | null): string {
		return signal === null ? `the agent exited with code ${code ?? "unknown"}` : `the agent was killed by ${signal}`;
	}

	private delay(ms: number): Promise<void> {
		if (this.options.sleep) return this.options.sleep(ms);
		return new Promise<void>((done) => {
			const timer = setTimeout(done, ms);
			timer.unref?.();
		});
	}

	private recordStderr(chunk: string): void {
		for (const line of chunk.split("\n")) {
			const text = line.trim();
			if (text === "") continue;
			// Restarts repeat the same line; the screen wants the sequence, not the repetition.
			if (this.stderr.at(-1) === text) continue;
			this.stderr.push(text.slice(0, STDERR_LINE_CHARS));
		}
		if (this.stderr.length > STDERR_LINES) this.stderr = this.stderr.slice(-STDERR_LINES);
	}

	private fail(reason: string): HarnessStatus {
		const status: HarnessStatus = {
			state: "failed",
			reason,
			expected: this.options.expected(),
			stderr: this.stderr.slice(-STDERR_LINES),
		};
		this.setStatus(status);
		return status;
	}

	private setStatus(status: HarnessStatus): void {
		this.status = status;
		this.options.onChange?.(status);
	}
}
