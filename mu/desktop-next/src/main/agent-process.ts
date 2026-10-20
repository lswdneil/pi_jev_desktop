// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The real process behind `AgentProcess`. Kept in its own file so `rpc.ts` and `supervisor.ts` stay testable without
 * starting anything: only `main/index.ts` reaches for this.
 */

import { spawn } from "node:child_process";
import type { AgentLaunch, AgentProcess } from "./rpc.ts";

/**
 * Start the agent. stdin/stdout carry the JSONL protocol; stderr is the agent's log, which the supervisor keeps the
 * tail of. `windowsHide` keeps a console window from flashing up on Windows — the old shell spawned consoles.
 */
export function spawnAgentProcess(launch: AgentLaunch): AgentProcess {
	const child = spawn(launch.command, [...launch.args], {
		cwd: launch.cwd,
		env: { ...process.env, ...launch.env },
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
	});
	child.stdout?.setEncoding("utf8");
	child.stderr?.setEncoding("utf8");
	// Writing to a child that has just died raises EPIPE; the exit handler reports the real reason.
	child.stdin?.on("error", () => {});

	return {
		pid: child.pid,
		onStdout: (listener) => {
			child.stdout?.on("data", (chunk: string) => listener(chunk));
		},
		onStderr: (listener) => {
			child.stderr?.on("data", (chunk: string) => listener(chunk));
		},
		onExit: (listener) => {
			child.once("exit", (code, signal) => listener(code, signal));
		},
		onError: (listener) => {
			child.once("error", listener);
		},
		write: (text) => {
			child.stdin?.write(text);
		},
		kill: () => {
			if (child.exitCode === null && child.signalCode === null) child.kill();
		},
	};
}
