// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The shell's side of the agent's JSONL protocol.
 *
 * pi ships an `RpcClient` for the same protocol, and this deliberately is not it: the client in
 * `packages/coding-agent/src/modes/rpc/rpc-client.ts` spawns the literal command `node` (`:94`), which a packaged app
 * does not have on its PATH, and it forwards the child's stderr to `process.stderr` (`:104`), which in Electron is the
 * app's own log. The shell owns its process: it names the executable, it keeps the last lines of stderr for the error
 * screen, and it decides when to retry.
 *
 * The message shapes are still pi's: `RpcCommand` and `RpcResponse` are imported as types only, so a rename upstream
 * fails `tsc` here instead of failing silently at runtime.
 */

import type { RpcCommand, RpcExtensionUIResponse, RpcResponse } from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "../shared/api.ts";

/** `RpcCommand` without `id`: we assign it, so a caller cannot collide with the request map. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export type RpcCommandBody = DistributiveOmit<RpcCommand, "id">;

/**
 * A running agent, as much of it as the shell needs. Narrowing it to this keeps the tests free of `child_process`:
 * a fake process can be driven line by line.
 */
export interface AgentProcess {
	readonly pid: number | undefined;
	onStdout(listener: (chunk: string) => void): void;
	onStderr(listener: (chunk: string) => void): void;
	onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
	onError(listener: (error: Error) => void): void;
	write(text: string): void;
	kill(): void;
}

/** Everything needed to start the agent: the executable, its arguments, where, and with what. */
export interface AgentLaunch {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly env: Readonly<Record<string, string>>;
}

export type SpawnAgent = (launch: AgentLaunch) => AgentProcess;

/** The request timeout. A prompt answers immediately; this covers a wedged agent instead of hanging the UI forever. */
export const REQUEST_TIMEOUT_MS = 20_000;

export class RpcTimeoutError extends Error {
	readonly command: string;

	constructor(command: string, timeoutMs: number) {
		super(`the agent did not answer ${command} within ${timeoutMs} ms`);
		this.name = "RpcTimeoutError";
		this.command = command;
	}
}

export class RpcClosedError extends Error {
	constructor(reason: string) {
		super(reason);
		this.name = "RpcClosedError";
	}
}

interface Pending {
	readonly command: string;
	readonly resolve: (response: RpcResponse) => void;
	readonly reject: (error: Error) => void;
	readonly timer: ReturnType<typeof setTimeout>;
}

export interface RpcConnectionOptions {
	readonly requestTimeoutMs?: number;
	readonly onEvent?: (event: AgentEvent) => void;
}

/**
 * One conversation with one agent process: numbered requests in, responses routed back, everything else is an event.
 */
export class RpcConnection {
	private readonly process: AgentProcess;
	private readonly requestTimeoutMs: number;
	private readonly pending = new Map<string, Pending>();
	private readonly eventListeners = new Set<(event: AgentEvent) => void>();
	private stdout = "";
	private nextId = 1;
	private closed: Error | undefined;
	private stderrTail = "";
	private unparsedLines = 0;

	constructor(process: AgentProcess, options: RpcConnectionOptions = {}) {
		this.process = process;
		this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
		if (options.onEvent) this.eventListeners.add(options.onEvent);

		process.onStdout((chunk) => this.read(chunk));
		process.onStderr((chunk) => {
			this.stderrTail = (this.stderrTail + chunk).slice(-8_192);
		});
		process.onExit((code, signal) => {
			this.close(new RpcClosedError(this.exitReason(code, signal)));
		});
		process.onError((error) => {
			this.close(new RpcClosedError(`the agent process failed: ${error.message}`));
		});
	}

	/** Send a command and wait for its response. Rejects on failure responses, on exit, and on timeout. */
	request(command: RpcCommandBody): Promise<RpcResponse> {
		if (this.closed) return Promise.reject(this.closed);
		const id = String(this.nextId++);
		return new Promise<RpcResponse>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new RpcTimeoutError(command.type, this.requestTimeoutMs));
			}, this.requestTimeoutMs);
			// The timer must not keep the app alive: a pending request is not a reason to stay open.
			timer.unref?.();
			this.pending.set(id, { command: command.type, resolve, reject, timer });
			this.write(JSON.stringify({ ...command, id }));
		});
	}

	/** Send a command whose response we do not wait for (a UI answer, for example). */
	send(message: RpcCommandBody | RpcExtensionUIResponse): void {
		if (this.closed) throw this.closed;
		this.write(JSON.stringify(message));
	}

	onEvent(listener: (event: AgentEvent) => void): () => void {
		this.eventListeners.add(listener);
		return () => {
			this.eventListeners.delete(listener);
		};
	}

	/** The agent's most recent stderr, for the error screen. */
	getStderrTail(): string {
		return this.stderrTail;
	}

	/** Lines that were not JSON. The agent prints nothing else, so a non-zero count means a broken build. */
	getUnparsedLines(): number {
		return this.unparsedLines;
	}

	getPendingCount(): number {
		return this.pending.size;
	}

	/** Stop routing, reject what is outstanding, and kill the process. */
	dispose(): void {
		this.close(new RpcClosedError("the conversation was closed"));
		this.process.kill();
	}

	private write(text: string): void {
		this.process.write(`${text}\n`);
	}

	private exitReason(code: number | null, signal: NodeJS.Signals | null): string {
		const how = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
		const tail = this.stderrTail.trim();
		return tail === "" ? `the agent exited with ${how}` : `the agent exited with ${how}: ${tail}`;
	}

	private close(reason: Error): void {
		if (this.closed) return;
		this.closed = reason;
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timer);
			pending.reject(reason);
			this.pending.delete(id);
		}
	}

	private read(chunk: string): void {
		this.stdout += chunk;
		let newline = this.stdout.indexOf("\n");
		while (newline !== -1) {
			const line = this.stdout.slice(0, newline).trim();
			this.stdout = this.stdout.slice(newline + 1);
			if (line !== "") this.handleLine(line);
			newline = this.stdout.indexOf("\n");
		}
	}

	private handleLine(line: string): void {
		let message: unknown;
		try {
			message = JSON.parse(line);
		} catch {
			this.unparsedLines++;
			return;
		}
		if (typeof message !== "object" || message === null) {
			this.unparsedLines++;
			return;
		}
		const record = message as Record<string, unknown>;
		if (record.type === "response") {
			this.handleResponse(record);
			return;
		}
		if (typeof record.type !== "string") {
			this.unparsedLines++;
			return;
		}
		for (const listener of this.eventListeners) listener(record as AgentEvent);
	}

	private handleResponse(record: Record<string, unknown>): void {
		const id = typeof record.id === "string" ? record.id : undefined;
		const pending = id === undefined ? undefined : this.pending.get(id);
		// A response without an id, or for an id we never sent, is not ours to act on.
		if (id === undefined || pending === undefined) return;
		this.pending.delete(id);
		clearTimeout(pending.timer);
		if (record.success === false) {
			const error = typeof record.error === "string" ? record.error : "the agent reported a failure";
			pending.reject(new Error(`${pending.command} failed: ${error}`));
			return;
		}
		pending.resolve(record as RpcResponse);
	}
}
