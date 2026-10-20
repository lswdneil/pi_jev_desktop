// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * A fake agent process, driven line by line. Shared by the RPC and supervisor tests so that neither has to start a
 * real process or wait for one to die.
 */

import type { AgentLaunch, AgentProcess } from "../../src/main/rpc.ts";

type ChunkListener = (chunk: string) => void;
type ExitListener = (code: number | null, signal: NodeJS.Signals | null) => void;
type ErrorListener = (error: Error) => void;

export class FakeProcess implements AgentProcess {
	readonly pid: number;
	readonly written: string[] = [];
	killed = false;
	/** What the process does once someone is listening for its exit: see `dyingProcess`. */
	dieWhenWatched: (() => void) | undefined;
	private stdoutListeners: ChunkListener[] = [];
	private stderrListeners: ChunkListener[] = [];
	private exitListeners: ExitListener[] = [];
	private errorListeners: ErrorListener[] = [];

	constructor(pid = 4_242) {
		this.pid = pid;
	}

	onStdout(listener: ChunkListener): void {
		this.stdoutListeners.push(listener);
	}

	onStderr(listener: ChunkListener): void {
		this.stderrListeners.push(listener);
	}

	onExit(listener: ExitListener): void {
		this.exitListeners.push(listener);
		// A process that is meant to die only dies once the supervisor is watching, otherwise the event lands in the
		// void between "spawned" and "handlers registered" — which is exactly what a real process does not do.
		const death = this.dieWhenWatched;
		if (death === undefined) return;
		this.dieWhenWatched = undefined;
		queueMicrotask(death);
	}

	onError(listener: ErrorListener): void {
		this.errorListeners.push(listener);
	}

	write(text: string): void {
		this.written.push(text);
	}

	kill(): void {
		this.killed = true;
	}

	/** The last command sent, parsed. */
	lastCommand(): Record<string, unknown> {
		const line = this.written.at(-1);
		if (line === undefined) throw new Error("nothing was written");
		return JSON.parse(line) as Record<string, unknown>;
	}

	/** Print one JSON message, as the agent would. */
	emit(message: unknown): void {
		this.emitChunk(`${JSON.stringify(message)}\n`);
	}

	emitChunk(text: string): void {
		for (const listener of this.stdoutListeners) listener(text);
	}

	/** Plain text on stdout, as a command that prints a line rather than a JSON message would. */
	emitStdout(text: string): void {
		this.emitChunk(text);
	}

	emitStderr(text: string): void {
		for (const listener of this.stderrListeners) listener(text);
	}

	die(code: number | null = 1, signal: NodeJS.Signals | null = null): void {
		for (const listener of this.exitListeners) listener(code, signal);
	}

	failToStart(message: string): void {
		for (const listener of this.errorListeners) listener(new Error(message));
	}
}

/** A spawn that hands out the given processes in order and records what it was asked to launch. */
export function fakeSpawn(processes: FakeProcess[]): {
	readonly launches: AgentLaunch[];
	readonly spawn: (launch: AgentLaunch) => AgentProcess;
} {
	const launches: AgentLaunch[] = [];
	return {
		launches,
		spawn: (launch) => {
			launches.push(launch);
			const next = processes.shift();
			if (next === undefined) throw new Error("the test ran out of fake processes");
			return next;
		},
	};
}
