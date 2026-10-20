// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { describe, expect, it } from "vitest";
import type { Harness } from "../../src/main/harness.ts";
import type { AgentLaunch, AgentProcess } from "../../src/main/rpc.ts";
import { type SupervisorOptions, AgentSupervisor, NotRunningError } from "../../src/main/supervisor.ts";
import { FakeProcess } from "./fakes.ts";

/**
 * The supervisor's job is the one the old shell did not do: notice that the agent died, try again, and if it stays
 * dead, say where mu should have been. Every test drives the process by hand, so no real child is started.
 */

const CHECKOUT: Harness = { root: "/work/KYRN", layout: "repo", source: "beside" };

interface Rig {
	readonly supervisor: AgentSupervisor;
	readonly delays: number[];
	readonly launches: AgentLaunch[];
	readonly statuses: string[];
	setHarness(harness: Harness | undefined): void;
}

function rig(processes: FakeProcess[], overrides: Partial<SupervisorOptions> = {}): Rig {
	let harness: Harness | undefined = CHECKOUT;
	const delays: number[] = [];
	const launches: AgentLaunch[] = [];
	const statuses: string[] = [];
	const queue = [...processes];

	const supervisor = new AgentSupervisor({
		locate: () => harness,
		launchOf: (found) => ({ command: `${found.root}/kyrn/bin/kyrn`, args: [], cwd: found.root, env: {} }),
		expected: () => ({ root: "/work/KYRN", layout: "repo" }),
		spawn: (launch): AgentProcess => {
			launches.push(launch);
			const next = queue.shift();
			if (next === undefined) throw new Error("the test ran out of fake processes");
			return next;
		},
		sleep: async (ms) => {
			delays.push(ms);
		},
		readyGraceMs: 0,
		onChange: (status) => statuses.push(status.state),
		...overrides,
	});

	return {
		supervisor,
		delays,
		launches,
		statuses,
		setHarness: (next) => {
			harness = next;
		},
	};
}

/** A process that dies as soon as the supervisor has had a chance to register its handlers. */
function dyingProcess(line?: string): FakeProcess {
	const process = new FakeProcess();
	process.dieWhenWatched = () => {
		if (line !== undefined) process.emitStderr(`${line}\n`);
		process.die(1);
	};
	return process;
}

/** A process that says a lot and then dies, to check what the failure screen keeps. */
function chattyProcess(lines: number): FakeProcess {
	const process = new FakeProcess();
	process.dieWhenWatched = () => {
		for (let index = 0; index < lines; index++) process.emitStderr(`line ${index}\n`);
		process.die(1);
	};
	return process;
}

/** A real macrotask: enough turns for the supervisor's microtasks to settle, without depending on their count. */
function settle(): Promise<void> {
	return new Promise((done) => {
		setTimeout(done, 5);
	});
}

/** The restart delays, without the grace waits that share the same injected sleep. */
function backoffOf(delays: readonly number[]): number[] {
	return delays.filter((ms) => ms > 0);
}

describe("starting", () => {
	it("reports where the agent is when it comes up", async () => {
		const agent = new FakeProcess(9_001);
		const test = rig([agent]);

		const status = await test.supervisor.start();

		expect(status).toEqual({ state: "running", root: "/work/KYRN", layout: "repo", pid: 9_001 });
		expect(test.launches[0]).toMatchObject({ command: "/work/KYRN/kyrn/bin/kyrn", cwd: "/work/KYRN" });
	});

	it("fails at once, with where mu should have been, when there is no harness", async () => {
		const test = rig([]);
		test.setHarness(undefined);

		const status = await test.supervisor.start();

		expect(status).toMatchObject({
			state: "failed",
			reason: "mu was not found where this build looks for it",
			expected: { root: "/work/KYRN", layout: "repo" },
		});
		expect(test.launches).toHaveLength(0);
	});

	it("does not start twice", async () => {
		const test = rig([new FakeProcess()]);
		await test.supervisor.start();
		await test.supervisor.start();
		expect(test.launches).toHaveLength(1);
	});

	it("does not become running after it was stopped during startup", async () => {
		let ready: () => void = () => {};
		const agent = new FakeProcess();
		const test = rig([agent], {
			sleep: () =>
				new Promise<void>((resolve) => {
					ready = resolve;
				}),
		});
		const starting = test.supervisor.start();
		await test.supervisor.stop();
		ready();
		await starting;
		expect(test.supervisor.getStatus()).toEqual({ state: "stopped" });
		expect(agent.killed).toBe(true);
	});

	it("keeps a replacement startup separate from the stopped attempt", async () => {
		const ready: Array<() => void> = [];
		const first = new FakeProcess(1);
		const second = new FakeProcess(2);
		const test = rig([first, second], { sleep: () => new Promise<void>((resolve) => ready.push(resolve)) });
		const starting = test.supervisor.start();
		const restarting = test.supervisor.restart();
		await Promise.resolve();
		expect(test.launches).toHaveLength(2);
		ready[0]?.();
		await starting;
		expect(test.supervisor.getStatus()).toEqual({ state: "starting" });
		ready[1]?.();
		await expect(restarting).resolves.toMatchObject({ state: "running", pid: 2 });
	});

	it("reports a synchronous spawn failure instead of leaving startup pending", async () => {
		const test = rig([], {
			retries: 0,
			spawn: () => {
				throw new Error("spawn denied");
			},
		});
		await expect(test.supervisor.start()).resolves.toMatchObject({
			state: "failed",
			reason: expect.stringContaining("spawn denied"),
		});
	});
});

describe("dying", () => {
	it("tries three times with the backoff, then fails with the agent's last words", async () => {
		const test = rig([
			dyingProcess("boom: no key"),
			dyingProcess("boom: no key"),
			dyingProcess("boom: no key"),
			dyingProcess("boom: no key"),
		]);

		const status = await test.supervisor.start();

		expect(backoffOf(test.delays)).toEqual([500, 1_000, 2_000]);
		expect(test.launches).toHaveLength(4);
		expect(status).toMatchObject({ state: "failed", reason: "the agent exited with code 1" });
		expect(status.state === "failed" ? status.stderr : []).toEqual(["boom: no key"]);
	});

	it("keeps only the tail of a long log, newest last", async () => {
		const test = rig([chattyProcess(60), dyingProcess(), dyingProcess(), dyingProcess()]);

		const status = await test.supervisor.start();

		const stderr = status.state === "failed" ? status.stderr : [];
		expect(stderr).toHaveLength(40);
		expect(stderr[0]).toBe("line 20");
		expect(stderr.at(-1)).toBe("line 59");
	});

	it("comes back after a crash, and says it is restarting first", async () => {
		const first = new FakeProcess(1);
		const second = new FakeProcess(2);
		const test = rig([first, second]);

		await test.supervisor.start();
		first.die(1);
		await settle();

		expect(test.statuses).toContain("restarting");
		expect(test.supervisor.getStatus()).toMatchObject({ state: "running", pid: 2 });
	});

	it("does not restart what the user stopped", async () => {
		const agent = new FakeProcess();
		const test = rig([agent]);
		await test.supervisor.start();

		await test.supervisor.stop();
		agent.die(1);
		await settle();

		expect(agent.killed).toBe(true);
		expect(test.supervisor.getStatus()).toEqual({ state: "stopped" });
	});

	it("restarts from a failure once the path is fixed", async () => {
		const test = rig([dyingProcess(), dyingProcess(), dyingProcess(), dyingProcess(), new FakeProcess(3)]);
		await test.supervisor.start();
		expect(test.supervisor.getStatus().state).toBe("failed");

		const status = await test.supervisor.restart();

		expect(status).toMatchObject({ state: "running", pid: 3 });
	});

	it("ignores the old process exiting after a manual restart", async () => {
		const first = new FakeProcess(1);
		const second = new FakeProcess(2);
		const test = rig([first, second]);
		await test.supervisor.start();
		await test.supervisor.restart();
		first.die(0);
		await settle();
		expect(test.supervisor.getStatus()).toMatchObject({ state: "running", pid: 2 });
		expect(test.launches).toHaveLength(2);
		const answer = test.supervisor.abort();
		second.emit({ type: "response", id: "1", command: "abort", success: true });
		await expect(answer).resolves.toBeUndefined();
	});
});

describe("talking to it", () => {
	it("refuses to prompt when there is no agent", async () => {
		const test = rig([]);
		await expect(test.supervisor.prompt("hello")).rejects.toBeInstanceOf(NotRunningError);
	});

	it("refuses an empty prompt", async () => {
		const test = rig([new FakeProcess()]);
		await test.supervisor.start();
		await expect(test.supervisor.prompt("   ")).rejects.toThrow("a prompt cannot be empty");
	});

	it("passes a prompt on and reports what happened to it", async () => {
		const agent = new FakeProcess();
		const test = rig([agent]);
		await test.supervisor.start();

		const answer = test.supervisor.prompt("  list the files  ");
		expect(agent.lastCommand()).toEqual({ type: "prompt", message: "list the files", id: "1" });
		agent.emit({ type: "response", id: "1", command: "prompt", success: true, data: { disposition: "started" } });

		await expect(answer).resolves.toEqual({ disposition: "started" });
	});

	it("summarises the session", async () => {
		const agent = new FakeProcess();
		const test = rig([agent]);
		await test.supervisor.start();

		const answer = test.supervisor.snapshot();
		agent.emit({
			type: "response",
			id: "1",
			command: "get_state",
			success: true,
			data: {
				sessionId: "session-1",
				model: { provider: "anthropic", id: "claude-sonnet-4" },
				thinkingLevel: "medium",
				isStreaming: false,
				messageCount: 3,
			},
		});

		await expect(answer).resolves.toEqual({
			sessionId: "session-1",
			model: "anthropic/claude-sonnet-4",
			thinkingLevel: "medium",
			isStreaming: false,
			messageCount: 3,
		});
	});

	it("aborts the running turn", async () => {
		const agent = new FakeProcess();
		const test = rig([agent]);
		await test.supervisor.start();

		const answer = test.supervisor.abort();
		agent.emit({ type: "response", id: "1", command: "abort", success: true });

		await expect(answer).resolves.toBeUndefined();
	});

	it("keeps the current conversation when the harness cancels a new session", async () => {
		const agent = new FakeProcess();
		const test = rig([agent]);
		await test.supervisor.start();
		const answer = test.supervisor.newSession();
		agent.emit({ type: "response", id: "1", command: "new_session", success: true, data: { cancelled: true } });
		await expect(answer).rejects.toThrow(/cancel/i);
	});
});
