# @kyrn/judge

> The package folder and the `kyrn.*` names stored in sessions keep the kernel's internal name; the product and its
> command are spec.ai.jev and `spec`.

spec.ai.jev's harness layer for [pi](https://github.com/earendil-works/pi): a small, fast judgment model makes the routine calls (what kind of turn is this, which tool output matters, which sub-agent and model fit a task, what to click next on a web page), code carries them out, and the main model keeps its context for thinking.

The judgment model is pluggable: Jev through the Vercel AI Gateway, a local Laya sidecar, any HTTP server that speaks `{state, questions}` → `{answers}`, or any generative model pi can reach. Features never know which one answers. Every decision fails open to pi's stock behaviour and is written to a ledger.

## Use it

```bash
pi install /path/to/KYRN/packages/kyrn-judge                 # the whole layer, as a pi package
pi -e packages/kyrn-judge/src/extension/kyrn-browser.ts      # only the browser
pi -e packages/kyrn-judge/src/extension/kyrn-swarm.ts        # only judge-routed sub-agents
```

From this repository, `kyrn/bin/spec` (on Windows `kyrn\bin\spec.cmd`; the launcher itself is `kyrn/bin/agent.mjs`) runs pi from source with the full extension and its own agent directory (`~/.spec.ai.jev/agent`). `spec link` puts the command on your PATH.

## Configure it

`<agent dir>/agent.json`, all optional:

```jsonc
{
  "tiers": ["laya", "jev"],          // asked in order; a later tier only gets what an earlier one is unsure of or not trusted on
  "judges": { "luna": { "type": "llm", "model": "openai-codex/gpt-5.6-luna" } },
  "modes": { "default": "active" },  // off | shadow (record only) | active (the default), per decision id
  "features": {
    "swarm": { "models": ["openai-codex/gpt-5.6-luna", "openai-codex/gpt-5.6-sol"] },   // cheapest to strongest
    "browser": { "headless": true }
  },
  "writer": "openai-codex/gpt-5.6-luna"
}
```

Environment: `SPEC_AI_JEV_JUDGE=laya,llm:provider/model` (or `off`), `SPEC_AI_JEV_JUDGE_MODE=active`. In a session: `/spec`, `/spec judge laya,jev`, `/spec mode tool.admission active`, `/agents`, `/remember`.

## What the main model gets

| Tool | What happens behind it |
| --- | --- |
| `browse({ url, goal })` | A real Chrome in spec.ai.jev's own profile. The judge picks every operation and target from the elements on the page until the goal is visibly met; only the final page and the action trace come back. Needs a judge that can relate a goal to a page (Jev or an `llm:` tier). |
| `delegate({ tasks })` | Each task runs in a fresh pi process. The judge picks the role (`agents/*.md`, pi's agent file format; add your own in `<agent dir>/agents/`), the model from your ladder and the thinking level. With no configuration: built-in roles on the session's current model. |
| `hive({ goal, bees })` | Several investigators on one hard problem. The judge decides after every step what is worth passing on and to whom; nobody's main model spends a token on it. |
| `locate({ query })` | Judge-ranked file paths instead of repeated grep. |
| `find_skill` | Lists skills the judge kept out of the system prompt. |

`delegate` and `hive` run on one swarm runtime (`src/swarm/`): every sub-agent streams its steps back, so the terminal shows for each one whether it is alive, what it is doing this second and what it last said. A watchdog ends a sub-agent that shows no sign of life, a time budget asks it for its report before ending it, and `/swarm stop [name]` or `/swarm kill [name]` does the same by hand without throwing away what was found. Limits: `features.swarm` / `features.hive` → `concurrency`, `beeMinutes`, `graceSeconds`, `stallSeconds`, `toolStallSeconds`.

Everything else (turn preflight, tool-output admission, context forgetting, risk guard, drift and completion checks, memory, cache warming) runs on pi's extension events. The map of every decision point is in [`kyrn/docs/04-injection-points.md`](../../kyrn/docs/04-injection-points.md).

## Browser safety

Own Chrome profile (`~/.spec.ai.jev/browser-profile`), never the user's. Password, file and hidden inputs are never offered to the judge. Clicks that look irreversible (pay, delete, send) need confirmation and stop when nobody can give it. Page text is passed along as untrusted data. Closed shadow roots, iframes and canvas-only interfaces are not observed.

The browser is a TypeScript port of [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) (MIT); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Develop

```bash
cd packages/kyrn-judge && npx vitest --run    # browser tests start a headless Chrome and skip themselves without one
npm run check                                 # from the repository root
```
