import { type DeadlinePreset, deadlinePolicy } from "@earendil-works/pi-ai/utils/deadline";
import { CascadeJudge, type CascadeTier } from "./cascade.ts";
import { BUILT_IN_JUDGES, type JudgeConfig, type KyrnConfig } from "./config.ts";
import { JudgeError } from "./errors.ts";
import { Judge, type JudgeLike } from "./judge.ts";
import { specEnv } from "./naming.ts";
import { type ClassifierCall, ClassifierJudgeProvider } from "./providers/classifier.ts";
import { FreeJevFallback, type FreeJevOutcome } from "./providers/free-jev.ts";
import { type ApiKeyResolver, GatewayJudgeProvider } from "./providers/gateway.ts";
import { type LlmCompletion, LlmJudgeProvider } from "./providers/llm.ts";
import { LocalJudgeProvider } from "./providers/local.ts";
import { MockJudgeProvider } from "./providers/mock.ts";
import { CLM_DEFAULT_MODEL, clmEndpoint, TypeSafeJudgeProvider } from "./providers/typesafe.ts";
import type { JudgeProvider } from "./types.ts";

/** What only the host application can supply: credentials and generative models. */
export interface JudgeHost {
	gatewayApiKey?: ApiKeyResolver;
	/** The `fetch` judge providers call with, e.g. one that keeps its connections open between calls. */
	fetch?: typeof fetch;
	/** A completion function bound to "provider/model-id", or undefined when the host has no such model. */
	llm?: (model: string, options: { thinking?: string }) => LlmCompletion | undefined;
	/** A classifier model of the host's catalog, bound to "provider/model-id", or undefined when the host has none. */
	classify?: (model: string) => ClassifierCall | undefined;
	/** How each call to the free Jev went, when the `jev` judge falls back to it (no key for any of Jev's services). */
	freeJev?: (outcome: FreeJevOutcome) => void;
	env?: Readonly<Record<string, string | undefined>>;
	/**
	 * Whether the keyless default judge may run. Absent means the caller made its own arrangement and the
	 * judge is built as configured; a judge the person configured with their own key is its own consent.
	 */
	consent?: { judgeId: string; consented: boolean; grantHint: string };
}

const DEFAULT_JUDGE_TIMEOUT_MS = 10_000;

/** Which deadline preset sizes a judge type. */
const PRESET_FOR_TYPE: Readonly<Record<JudgeConfig["type"], DeadlinePreset>> = {
	jev: "judge",
	typesafe: "judge",
	classifier: "judge",
	clm: "judge",
	http: "judge",
	gateway: "judge",
	local: "judge",
	llm: "judge-generative",
	mock: "mock",
};

/**
 * Budgets that are deliberately tighter than the type's preset: a fast tier has to fail
 * quickly so the next tier still has time inside the caller's wait. Measured values, kept
 * here so the preset stays the one place a budget is raised.
 */
const TIGHTER_TIMEOUT_MS: Readonly<Partial<Record<JudgeConfig["type"], number>>> = {
	// A CLM server embeds every question together with the state: a batch of long ones takes seconds on a small GPU.
	clm: 8_000,
	http: 8_000,
	gateway: 4_000,
	local: 4_000,
};

/** The budget for one judge call when the config does not set one. */
export function defaultJudgeTimeoutMs(type: JudgeConfig["type"]): number {
	const presetTotal = deadlinePolicy(PRESET_FOR_TYPE[type]).totalMs ?? 0;
	const tighter = TIGHTER_TIMEOUT_MS[type];
	if (tighter !== undefined) {
		return presetTotal > 0 ? Math.min(tighter, presetTotal) : tighter;
	}
	return presetTotal > 0 ? presetTotal : DEFAULT_JUDGE_TIMEOUT_MS;
}

/**
 * Keys for a service other than TypeSafe (Jev on OpenRouter, an address of the user's own, a CLM server). Any other
 * variable may hold a TypeSafe key under a name of its own, and goes to TypeSafe when no address is set.
 */
const KEYS_FOR_ELSEWHERE: ReadonlySet<string> = new Set([
	"SPEC_AI_JEV_JUDGE_OPENROUTER_API_KEY",
	"SPEC_AI_JEV_JUDGE_CUSTOM_API_KEY",
	"SPEC_AI_JEV_JUDGE_CLM_API_KEY",
]);

/** `llm:provider/model` and `classifier:provider/model` name a judge inline, without a `judges` entry. */
export function resolveJudgeConfig(name: string, config: KyrnConfig): JudgeConfig | undefined {
	if (name.startsWith("llm:")) return { type: "llm", model: name.slice("llm:".length) };
	if (name.startsWith("classifier:")) return { type: "classifier", model: name.slice("classifier:".length) };
	return config.judges[name] ?? BUILT_IN_JUDGES[name];
}

/**
 * The environment variables a judge may read its key from, most specific first. One place, so the credentials
 * bridge cannot disagree with the provider factory about which variable a key belongs in.
 *
 * Judges that reach the host's own credentials (`llm`, `classifier`) and judges that need none (`local`, `mock`)
 * have no variable here: their keys never live in a `.env`.
 */
export function judgeKeyEnvNames(judge: JudgeConfig): readonly string[] {
	switch (judge.type) {
		case "typesafe":
			return [judge.apiKeyEnv ?? "TYPESAFE_API_KEY"];
		case "clm":
			return [judge.apiKeyEnv ?? "SPEC_AI_JEV_JUDGE_CLM_API_KEY"];
		case "http":
			return judge.apiKeyEnv === undefined ? [] : [judge.apiKeyEnv];
		case "jev": {
			const own = judge.apiKeyEnv ?? "TYPESAFE_API_KEY";
			// `jev` tries TypeSafe, then Jev on OpenRouter, then the gateway, then OpenCode and Cloudflare.
			return [own, "SPEC_AI_JEV_JUDGE_OPENROUTER_API_KEY", "AI_GATEWAY_API_KEY", "OPENCODE_API_KEY", "CLOUDFLARE_API_KEY"];
		}
		case "gateway":
			return [judge.apiKeyEnv ?? "AI_GATEWAY_API_KEY"];
		case "classifier":
		case "llm":
		case "local":
		case "mock":
			return [];
		default:
			return [judge.apiKeyEnv ?? "AI_GATEWAY_API_KEY"];
	}
}

function createProvider(name: string, judge: JudgeConfig, host: JudgeHost): JudgeProvider {
	switch (judge.type) {
		case "mock":
			return new MockJudgeProvider();
		case "local":
			return new LocalJudgeProvider({
				baseUrl: judge.baseUrl ?? specEnv("LOCAL_JUDGE_URL", host.env ?? {}),
				fetch: host.fetch,
			});
		case "http": {
			const apiKeyEnv = judge.apiKeyEnv;
			return new LocalJudgeProvider({
				id: `http:${name}`,
				baseUrl: judge.baseUrl,
				path: judge.path,
				headers: (): Record<string, string> => {
					const token = apiKeyEnv ? host.env?.[apiKeyEnv] : undefined;
					return token ? { Authorization: `Bearer ${token}` } : {};
				},
				fetch: host.fetch,
			});
		}
		case "llm": {
			if (!judge.model) throw new TypeError(`Judge "${name}" needs a model ("provider/model-id")`);
			const complete = host.llm?.(judge.model, { thinking: judge.thinking });
			if (!complete) throw new TypeError(`Judge "${name}": model "${judge.model}" is not available`);
			return new LlmJudgeProvider({ id: `llm:${judge.model}`, complete });
		}
		case "classifier": {
			if (!judge.model?.includes("/")) throw new TypeError(`Judge "${name}" needs a model ("provider/model-id")`);
			const call = host.classify?.(judge.model);
			if (!call) throw new TypeError(`Judge "${name}": classifier models need a mu session`);
			return new ClassifierJudgeProvider({ model: judge.model, call });
		}
		case "typesafe": {
			const keyName = judge.apiKeyEnv ?? "TYPESAFE_API_KEY";
			// A key set up for another service goes only to the address it was set up with, never to TypeSafe's.
			if (KEYS_FOR_ELSEWHERE.has(keyName) && !judge.baseUrl) {
				throw new TypeError(`Judge "${name}" needs a baseUrl: its key ${keyName} is not sent to TypeSafe`);
			}
			return new TypeSafeJudgeProvider({
				apiKey: () => host.env?.[keyName],
				keyName,
				model: judge.model,
				baseUrl: judge.baseUrl,
				fetch: host.fetch,
			});
		}
		case "clm": {
			// `clm-serve` asks for a key only when it was started with CLM_API_KEY; without one set here, none is sent.
			const keyName = judge.apiKeyEnv ?? "SPEC_AI_JEV_JUDGE_CLM_API_KEY";
			return new TypeSafeJudgeProvider({
				apiKey: () => host.env?.[keyName],
				keyName,
				keyOptional: true,
				judgeName: "CLM",
				model: judge.model || CLM_DEFAULT_MODEL,
				baseUrl: clmEndpoint(judge.baseUrl),
				fetch: host.fetch,
			});
		}
		case "jev": {
			// A TypeSafe key is the direct route, a key for Jev on OpenRouter the next, then a Vercel AI Gateway key, an
			// OpenCode key (the paid Jev) and Cloudflare's key and account. Without any of them: the Vercel AI Gateway
			// when pi keeps a key for it, else Jev 1.13 on OpenCode Zen, free for a limited time, with no key at all.
			// Each service names the model its own way: a model set here is TypeSafe's ("jev-latest"), and reaches the
			// gateway only when it is written the gateway's way ("typesafe-ai/jev").
			const env = host.env ?? {};
			if (env[judge.apiKeyEnv ?? "TYPESAFE_API_KEY"])
				return createProvider(name, { ...judge, type: "typesafe" }, host);
			const openRouter = BUILT_IN_JUDGES["jev-openrouter"];
			if (openRouter.apiKeyEnv && env[openRouter.apiKeyEnv]) return createProvider(name, openRouter, host);
			const model = judge.model?.includes("/") ? judge.model : "typesafe-ai/jev";
			const gateway: JudgeConfig = { ...judge, type: "gateway", model };
			if (env.AI_GATEWAY_API_KEY) return createProvider(name, gateway, host);
			if (host.classify) {
				// The keyless endpoint spends someone else's budget: without consent the request is not made at all.
				if (host.consent && !host.consent.consented) return new UnconsentedJudgeProvider(host.consent);
				if (env.OPENCODE_API_KEY) return createProvider(name, BUILT_IN_JUDGES["jev-opencode"], host);
				if (env.CLOUDFLARE_API_KEY && env.CLOUDFLARE_ACCOUNT_ID) {
					return createProvider(name, BUILT_IN_JUDGES["jev-cloudflare"], host);
				}
				return new FreeJevFallback({
					gateway: createProvider(name, gateway, host),
					free: createProvider(name, BUILT_IN_JUDGES["jev-opencode-free"], host),
					gatewayKey: host.gatewayApiKey ?? (() => env.AI_GATEWAY_API_KEY),
					onFree: host.freeJev,
				});
			}
			return createProvider(name, gateway, host);
		}
		default:
			return new GatewayJudgeProvider({
				apiKey: judge.apiKeyEnv
					? () => host.env?.[judge.apiKeyEnv!]
					: (host.gatewayApiKey ?? (() => host.env?.AI_GATEWAY_API_KEY)),
				model: judge.model,
				baseUrl: judge.baseUrl,
				fetch: host.fetch,
			});
	}
}

export interface BuiltJudge {
	readonly judge: JudgeLike;
	/** Tiers that could not be created, with the reason. The cascade runs without them. */
	readonly problems: readonly string[];
}

/** The configured tiers as one judge. Unknown or unavailable tiers are reported, not fatal. */
export function buildJudge(config: KyrnConfig, host: JudgeHost = {}): BuiltJudge {
	const tiers: CascadeTier[] = [];
	const problems: string[] = [];
	for (const name of config.tiers) {
		const judgeConfig = resolveJudgeConfig(name, config);
		if (!judgeConfig) {
			problems.push(`unknown judge "${name}"`);
			continue;
		}
		try {
			const provider = createProvider(name, judgeConfig, host);
			const timeoutMs = judgeConfig.timeoutMs ?? defaultJudgeTimeoutMs(judgeConfig.type);
			tiers.push({ judge: new Judge({ provider, timeoutMs }), profile: judgeConfig.profile });
		} catch (error) {
			problems.push(error instanceof Error ? error.message : String(error));
		}
	}
	if (tiers.length === 0) {
		problems.push("no usable judge; every decision falls back");
		tiers.push({ judge: new Judge({ provider: new UnavailableJudgeProvider() }) });
	}
	return { judge: new CascadeJudge(tiers), problems };
}

/** No judge at all fails as a judge without a key does: nothing answers until the user sets one up. */
class UnavailableJudgeProvider implements JudgeProvider {
	readonly id = "none";
	async evaluate(): Promise<never> {
		throw new JudgeError("auth", "No judge is configured");
	}
}

/**
 * The keyless default judge before the person agreed to it. It throws instead of calling: the point of the
 * gate is that no request leaves the machine, not that the answer is hidden afterwards.
 */
class UnconsentedJudgeProvider implements JudgeProvider {
	readonly id = "jev";
	private readonly hint: string;

	constructor(state: { grantHint: string }) {
		this.hint = state.grantHint;
	}

	async evaluate(): Promise<never> {
		throw new JudgeError("auth", `The default judge is waiting for your consent. ${this.hint}`);
	}
}
