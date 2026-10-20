import { EventEmitter } from "node:events";
import { deadlinePolicy } from "@earendil-works/pi-ai/utils/deadline";
import * as undici from "undici";

export const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000;
// Node's 250ms default can terminate valid connection attempts on high-latency routes.
const DEFAULT_AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS = 2_000;

export const HTTP_IDLE_TIMEOUT_CHOICES = [
	{ label: "30 sec", timeoutMs: 30_000 },
	{ label: "1 min", timeoutMs: 60_000 },
	{ label: "2 min", timeoutMs: 120_000 },
	{ label: "5 min", timeoutMs: 300_000 },
	{ label: "disabled", timeoutMs: 0 },
] as const;

const originalGlobalFetch = globalThis.fetch;
let installedGlobalFetch: typeof globalThis.fetch | undefined;

export function parseHttpIdleTimeoutMs(value: unknown): number | undefined {
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.toLowerCase() === "disabled") {
			return 0;
		}
		if (trimmed.length === 0) {
			return undefined;
		}
		return parseHttpIdleTimeoutMs(Number(trimmed));
	}

	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return undefined;
	}
	return Math.floor(value);
}

export function formatHttpIdleTimeoutMs(timeoutMs: number): string {
	const choice = HTTP_IDLE_TIMEOUT_CHOICES.find((item) => item.timeoutMs === timeoutMs);
	if (choice) {
		return choice.label;
	}
	return `${timeoutMs / 1000} sec`;
}

export function applyHttpProxySettings(httpProxy: string | undefined): void {
	const proxy = httpProxy?.trim();
	if (!proxy) return;
	process.env.HTTP_PROXY ??= proxy;
	process.env.HTTPS_PROXY ??= proxy;
}

const ignoreUndiciDispatcherError = (_error: unknown): void => {}; // Undici can emit an internal Client "error" while terminating a mid-stream
// fetch body. The body stream still rejects through reader.read(); this listener
// only prevents EventEmitter's unhandled "error" special case from crashing pi.
function withUndiciErrorListener<T extends undici.Dispatcher>(dispatcher: T): T {
	if (dispatcher instanceof EventEmitter) {
		EventEmitter.prototype.on.call(dispatcher, "error", ignoreUndiciDispatcherError);
	}
	return dispatcher;
}

function createUndiciClient(origin: string | URL, options: object): undici.Dispatcher {
	return withUndiciErrorListener(new undici.Client(origin, options as undici.Client.Options));
}

function createUndiciOriginDispatcher(origin: string | URL, options: object): undici.Dispatcher {
	const dispatcherOptions = options as undici.Pool.Options;
	if (dispatcherOptions.connections === 1) {
		return createUndiciClient(origin, dispatcherOptions);
	}
	return withUndiciErrorListener(
		new undici.Pool(origin, {
			...dispatcherOptions,
			factory: createUndiciClient,
		}),
	);
}

/**
 * Per-stage budgets for the HTTP client.
 *
 * `firstByteMs` maps onto undici's `headersTimeout`, which ends when the response
 * headers arrive — slightly earlier than the first body chunk. `idleMs` maps onto
 * `bodyTimeout`, whose own meaning is already "the gap between two chunks".
 *
 * `connectMs` has no undici equivalent: the handshake is bounded by the agent's
 * connect settings and the OS timeout, and a deadline outside the client cannot
 * observe it. It is accepted so a deadline policy can be passed through whole and
 * documented, instead of being silently dropped.
 */
export interface HttpTimeoutOptions {
	firstByteMs?: number;
	idleMs?: number;
	connectMs?: number;
}

export interface HttpTimeouts {
	headersTimeoutMs: number;
	bodyTimeoutMs: number;
}

/** Maps a stage policy onto the two budgets undici exposes. Pure, so a test can read it. */
export function resolveHttpTimeouts(timeoutMs: number, options?: HttpTimeoutOptions): HttpTimeouts {
	for (const [name, value] of [
		["firstByteMs", options?.firstByteMs],
		["idleMs", options?.idleMs],
		["connectMs", options?.connectMs],
	] as const) {
		if (value !== undefined && parseHttpIdleTimeoutMs(value) === undefined) {
			throw new Error(`Invalid HTTP ${name}: ${String(value)}`);
		}
	}
	return {
		headersTimeoutMs: options?.firstByteMs ?? timeoutMs,
		bodyTimeoutMs: options?.idleMs ?? timeoutMs,
	};
}

/**
 * The budgets an app runtime should use: the user's idle setting for the body,
 * plus the provider stream's first-byte cap so a request that never starts
 * answering fails in seconds instead of at the idle limit.
 *
 * 0 (the user disabled HTTP timeouts) keeps meaning "no timeouts": the cap is not
 * reintroduced behind their back. When the user's idle budget is already tighter
 * than the cap, the user's number wins.
 */
export function providerStreamHttpOptions(idleTimeoutMs: number): HttpTimeoutOptions | undefined {
	if (idleTimeoutMs === 0) return undefined;
	const cap = deadlinePolicy("provider-stream").firstByteMs ?? 0;
	if (cap <= 0) return undefined;
	return { firstByteMs: Math.min(cap, idleTimeoutMs), idleMs: idleTimeoutMs };
}

/** `configureHttpDispatcher` from the user's idle setting, with the provider-stream first-byte cap. */
export function configureHttpDispatcherFromIdleSetting(idleTimeoutMs: number): void {
	configureHttpDispatcher(idleTimeoutMs, providerStreamHttpOptions(idleTimeoutMs));
}

export function configureHttpDispatcher(
	timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS,
	options?: HttpTimeoutOptions,
): void {
	const normalizedTimeoutMs = parseHttpIdleTimeoutMs(timeoutMs);
	if (normalizedTimeoutMs === undefined) {
		throw new Error(`Invalid HTTP idle timeout: ${String(timeoutMs)}`);
	}
	const budgets = resolveHttpTimeouts(normalizedTimeoutMs, options);
	const dispatcher = withUndiciErrorListener(
		new undici.EnvHttpProxyAgent({
			allowH2: false,
			// Keep HTTP origins on CONNECT tunnels as they were before Undici 8.7.
			proxyTunnel: true,
			bodyTimeout: budgets.bodyTimeoutMs,
			connect: {
				autoSelectFamilyAttemptTimeout: DEFAULT_AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS,
			},
			headersTimeout: budgets.headersTimeoutMs,
			clientFactory: createUndiciClient,
			factory: createUndiciOriginDispatcher,
		}),
	);
	undici.setGlobalDispatcher(dispatcher);
	// Keep fetch and the dispatcher on the same undici implementation. Node 26.0's
	// bundled fetch can otherwise consume compressed responses through npm undici's
	// dispatcher without decompressing them, causing response.json() failures.
	// If a caller replaced fetch after module load, preserve that deliberate override.
	const shouldInstallGlobals =
		installedGlobalFetch === undefined
			? globalThis.fetch === originalGlobalFetch
			: globalThis.fetch === installedGlobalFetch;
	if (shouldInstallGlobals) {
		undici.install?.();
		installedGlobalFetch = globalThis.fetch;
	}
}
