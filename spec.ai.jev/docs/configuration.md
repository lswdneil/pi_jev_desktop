# Configuration

spec.ai.jev reads pi's settings (models, sign-ins, preferences: see [pi's documentation](https://github.com/earendil-works/pi/tree/main/packages/coding-agent#readme)) and its own, in `~/.spec.ai.jev/agent/agent.json`. The desktop app's settings write the same file; every change made there can be made by hand, and the other way round.

Only your own `agent.json` is read. A project cannot change the judge, its endpoint or its modes: the judge reads your messages.

## agent.json

```json
{
  "tiers": ["jev"],
  "modes": {
    "default": "active",
    "turn.continue": "shadow",
    "output.drift": "off"
  },
  "routes": {
    "browser.step": ["jev"],
    "memory.capture": ["laya", "jev"]
  },
  "judges": {
    "my-relay": {
      "type": "typesafe",
      "baseUrl": "https://relay.example.com/v1/systemone",
      "apiKeyEnv": "MY_RELAY_KEY"
    }
  },
  "features": {
    "admission": { "testLog": "rules" },
    "injection": { "tools": ["web_fetch", "web_search", "browse", "mcp__*"] },
    "ttsr": false
  },
  "writer": "anthropic/claude-haiku-4-5",
  "recordState": false
}
```

| Key | Meaning | Default |
| --- | --- | --- |
| `tiers` | The judges that answer, in order. A later judge only sees what the earlier ones left uncertain: `["laya", "jev"]` asks the local judge first. | `["jev"]` |
| `modes` | `default` plus one entry per decision point: `active` (verdicts take effect), `shadow` (asked and logged, nothing changes) or `off` (not asked). | `{ "default": "active" }` |
| `routes` | A decision point on its own judges, in place of `tiers`. | none |
| `judges` | Named judges of your own, added to the built-in ones. See [Judges](judges.md#your-own-judge). | none |
| `features` | Per-feature switches and options: `false` turns a feature off, an object overrides options. Every feature and option: [reference/features.md](reference/features.md). | each feature's defaults |
| `writer` | `provider/model-id` of a small generative model for what a judge cannot do: writing the task frame and lessons. Empty uses the session's model. | none |
| `recordState` | Keep the judged state in the ledger, not only the verdict. Needed to train a local judge on your sessions; off because states hold your content. | `false` |
| `mcp` | spec.ai.jev's own MCP servers: `{ "servers": { "<name>": { "command": … } } }`. Servers from Claude Code, Cursor and Codex settings are found too (`features.inherit`). | none |

A part spec.ai.jev does not understand falls back to its default instead of stopping spec.ai.jev. A file that cannot be parsed at all is reported when a session starts, and the defaults are used.

## Modes in practice

- Every point acts from the start. To try a judge, or a point you are unsure of, put it in shadow, read the ledger (`spec ledger`, `/status`, or the judgments tab), then set it back to active when its verdicts look right.
- `/spec mode <point> <off|shadow|active>` switches one point for the current session; `/spec mode default shadow` all of them. To keep a mode, put it in `agent.json`; the app's settings switch points on or off.
- `SPEC_AI_JEV_JUDGE_MODE=shadow spec.ai.jev` sets the default for one run.

Every decision point, with what it decides: [reference/decision-points.md](reference/decision-points.md).

## Environment variables

Judges and modes:

| Variable | Effect |
| --- | --- |
| `SPEC_AI_JEV_JUDGE` | Judges for this run, comma-separated: `laya`, `laya,jev`, `jev-opencode-free`, `classifier:<provider>/<model>`, `llm:<provider>/<model>`. `off` turns the kernel off. |
| `SPEC_AI_JEV_JUDGE_MODE` | Default mode for this run: `off`, `shadow` or `active`. |
| `SPEC_AI_JEV_WRITER` | `provider/model-id` for the writer model. |
| `SPEC_AI_JEV_PERMISSIONS` | Permission mode for this run: `full`, `jev` or `ask`. |
| `SPEC_AI_JEV_LOCAL_JUDGE_URL` | Address of a local judge server other than the one `spec judge start` runs. |

Keys for Jev, each used only by the service it belongs to ([Judges](judges.md#hosted-jev)): `TYPESAFE_API_KEY`, `SPEC_AI_JEV_JUDGE_OPENROUTER_API_KEY`, `AI_GATEWAY_API_KEY`, `OPENCODE_API_KEY`, `CLOUDFLARE_API_KEY` with `CLOUDFLARE_ACCOUNT_ID`, `SPEC_AI_JEV_JUDGE_CLM_API_KEY`.

The launcher:

| Variable | Effect |
| --- | --- |
| `SPEC_AI_JEV_AGENT_DIR` | The agent folder, in place of `~/.spec.ai.jev/agent`. |
| `SPEC_AI_JEV_NO_SETUP=1` | Never ask to set up a model at the first start. |
| `SPEC_AI_JEV_LANG` | A language tag (`zh-CN`, `en`, `ja`…) for spec.ai.jev's own messages in a session: Chinese for `zh`, English otherwise. Unset, sessions speak English; `spec setup` follows your locale. The desktop app sets it to the app's language. |
| `SPEC_AI_JEV_LINK_DIR` | Where `spec link` puts the `spec.ai.jev` command, in place of `~/.local/bin`. |
| `SPEC_AI_JEV_CHROME` | The Chrome or Chromium the built-in browser uses on the command line. |

Only the `SPEC_AI_JEV_` spelling is read.

spec.ai.jev reads a `.env` file too: `~/.spec.ai.jev/.env` for the npm package, the repository's `.env` for a checkout. Lines are `KEY=VALUE`; nothing in the file is executed. `spec setup` writes the Jev key there. Variables already set in your environment win.

## Proxies, custom CAs, and offline

Anything that talks to the network — providers, the judge, MCP servers, the browser — goes through the same
two settings, so a machine behind a proxy needs them set once.

| Setting | Effect |
| --- | --- |
| `HTTPS_PROXY` / `HTTP_PROXY` (or `https_proxy` / `http_proxy`, or `ALL_PROXY`) | The proxy for that protocol. `agent.json`'s `httpProxy` sets both when they are unset. |
| `npm_config_https_proxy` / `npm_config_http_proxy` / `npm_config_proxy` | The same values as npm exported them from `.npmrc`. Read as a fallback, so one proxy configured for installs also covers a session. |
| `NO_PROXY` / `no_proxy` / `npm_config_no_proxy` / `npm_config_noproxy` | Hosts that go direct: exact names, `*.domain` and `.domain` suffixes, ports, IPv6 literals, or `*` for none. |
| `NODE_EXTRA_CA_CERTS=<file>` | A PEM bundle every TLS connection also trusts — what a TLS-inspecting corporate proxy needs. Node reads it **once, at process start**; change it and restart spec.ai.jev. |

`spec doctor --offline` answers "is this machine set up?" without touching the network: platform, Node version,
layout, settings, which judge variables are set, and whether a proxy or a custom CA is configured (presence
only — no values, no requests).

**Offline.** With no reachable network the judge's decisions fall back to what spec.ai.jev does without a judge, and a
provider call fails with the provider's own connection error rather than hanging: the first-byte and idle
budgets (`## Timeouts and cancellation`) end it. Nothing waits forever and nothing blocks on a prompt when
there is no terminal: see below.

**No terminal.** In CI, in a container, or as the desktop app's child process, the consent question for the
keyless judge cannot be asked, so it is answered from the environment instead: `SPEC_AI_JEV_JUDGE_CONSENT=1` grants it
for that run, `SPEC_AI_JEV_JUDGE=off` asks no judge at all. Without either, every decision falls back and spec.ai.jev says once
how to grant it — it never waits for input that cannot arrive.

## Proxies
spec.ai.jev follows `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`. The desktop app also follows the system proxy (macOS network settings, Windows Internet settings) when no `HTTPS_PROXY` is set. pi's `httpProxy` setting works as well.

## Timeouts and cancellation

One budget per stage, not one number per call. A request that never starts answering and a stream that goes quiet are different failures, and a log that cannot tell them apart cannot be acted on.

| Stage | What it bounds | Where it is enforced |
| --- | --- | --- |
| `connect` | The handshake, before any request byte moves | The HTTP client: undici connect settings and the OS timeout. A caller outside the client cannot observe it, so a policy carries the number without arming a timer. |
| `first-byte` | From request sent to the first response headers | `headersTimeout` of the HTTP client (`http-dispatcher.ts`) |
| `idle` | The gap between two chunks of a stream, restarted per chunk | `bodyTimeout` of the HTTP client (`http-dispatcher.ts`), and `withDeadline()` for streams (`packages/ai/src/utils/deadline.ts`) |
| `total` | The whole request, when you want a hard ceiling | The deadline's own timer |

When a budget runs out, the error is a `DeadlineError` carrying `kind` (`timeout` or `aborted`), `stage` and the budget that fired. `deadlineStageOf(error)` reads the stage back out, and `transportStageOf(error)` does the same for the errors the HTTP client throws when its own `headersTimeout`/`bodyTimeout` fire — those never pass through a deadline. A user cancellation is `stage: "aborted"`, so "the person stopped it" never looks like "the network failed".

What you control, and what the defaults are:

| Knob | Effect |
| --- | --- |
| `httpIdleTimeoutMs` setting (`/settings`, default 5 min, `disabled` allowed) | The `idle` budget of pi-managed HTTP, and the fallback for `first-byte`. It is **not** the total budget of a provider request. |
| `retry.provider.timeoutMs` setting | An explicit total budget for one provider request. Unset, a provider stream has no total: a long answer is not a hang, and `idle` + your own cancellation cover the case that is. |
| `bashTimeoutMs` setting (default unset = no timeout) | A default cap for one bash command. The `timeout` the model passes still wins. A command that outlives the cap is killed with its whole process tree. |
| `SPEC_AI_JEV_DEADLINE_<PRESET>_<STAGE>` environment variable | Overrides one stage of a preset, in whole milliseconds, for a test or a diagnosis (`SPEC_AI_JEV_DEADLINE_JUDGE_TOTAL=15000`, `SPEC_AI_JEV_DEADLINE_PROVIDER_STREAM_FIRST_BYTE=60000`). `0` disables that stage. An invalid value is ignored with one warning. |

Presets, in `packages/ai/src/utils/deadline.ts`:

| Preset | first-byte | idle | total |
| --- | --- | --- | --- |
| `provider-stream` | 30 s | 60 s | none |
| `judge` | 4 s | — | 10 s |
| `judge-generative` | 4 s | — | 30 s |
| `mcp-call` | 10 s | — | 60 s |
| `lsp-request` | 5 s | — | 30 s |
| `browser-step` | 10 s | — | 60 s |
| `bash-command` | — | — | none by default |
| `mock` | 1 s | — | 1 s |

How long spec.ai.jev waits for a verdict follows from the same table: a judge cascade runs tier after tier, so the wait is the **sum** of the tiers' totals plus 250 ms, not one tier's. `features.admission.waitMs` raises that floor; it cannot lower it.

## Per-feature options

Each feature's options, defaults and ranges are generated from the same manifest the app's settings use: [reference/features.md](reference/features.md). Some that are often changed:

| Setting | What it does |
| --- | --- |
| `features.admission.testLog` | `"rules"` folds exact repeats in test logs, `"jev"` adds goal-aware selection. Off by default. |
| `features.board.defaultOn` | Start every session with the plain-language board on. |
| `features.permissions.mode` | The permission mode of a new conversation before you pick one. |
| `features.injection.tools` | Which tools' results are screened for prompt injection. |
| `features.continuation.maxNudges` | How often a run that stopped short is sent back, per message. |
| `features.swarm.models` | Model tiers sub-agents may be routed to, cheapest first. |
