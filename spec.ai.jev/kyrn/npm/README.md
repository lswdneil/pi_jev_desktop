# spec.ai.jev

**A coding agent that thinks before it acts.** A small, fast judge makes the routine calls. The big model keeps its attention for the work.

> **Early development.** spec.ai.jev works day to day for its authors, but names, settings and file formats may still change. Source, docs and the desktop app: [github.com/qybaihe/spec](https://github.com/qybaihe/spec) (README in English, 简体中文, 繁體中文, 日本語 and 한국어).

## Install

```bash
npm i -g spec-ai-agent
spec.ai.jev
```

You need Node.js 22.19 or newer. The package is called `spec-ai-agent`; the command is `spec.ai.jev`. It works on macOS, Linux, Windows and WSL.

`spec setup` connects a model from your shell: paste an API key and spec.ai.jev tells which service it belongs to (DeepSeek, Qwen, Kimi, GLM, SiliconFlow, StepFun, OpenRouter, OpenCode Zen, OpenAI, Anthropic, Google Gemini, xAI), or pick Ollama or an address of your own. It checks the key with one request, picks the model to start with, and sets up the judge. The first `spec.ai.jev` offers to run it while no model is set up.

Inside spec.ai.jev, `/login` signs in to a model provider or a subscription and `/model` picks a model. `/help` lists everything. `spec doctor` checks the setup from your shell.

## What it adds to pi

spec.ai.jev is built on [pi](https://github.com/earendil-works/pi). It hands the small questions a coding agent keeps asking to a **judge**: is this message a new task or a correction, does this command need your permission, which part of a long test log matters, which sub-agent fits a job, what should the browser click next. Code acts on the answers, and the main model only sees what it needs.

- **Every decision is visible.** Each one is `off`, `shadow` (asked and logged, not acted on) or `active`. `/ledger` and `spec ledger` show the verdicts.
- **Every decision fails open.** When the judge is unsure, slow or unreachable, a plain rule decides, or pi's own behaviour runs.
- Also: a task frame that holds your constraints in your own words, three permission modes (`/permissions`), goal mode (`/goal`), a plain-language progress board (`/board`), checkpoints and `/rewind`, sub-agents in their own git worktrees (`delegate`, `hive`), a judge-driven browser (`browse`), and your rules, skills and MCP servers from Claude Code, Cursor and Codex.

## Choose a judge

With nothing set up, Jev 1.13 on OpenCode Zen answers, free for a limited time and with no key: what it judges goes to OpenCode, which does not train on it, and spec.ai.jev says so once a day. To send nothing anywhere, start spec.ai.jev with `SPEC_AI_JEV_JUDGE=off`, or use the local Laya.

- **Jev** (hosted): set `TYPESAFE_API_KEY` (TypeSafe), `SPEC_AI_JEV_JUDGE_OPENROUTER_API_KEY` (Jev on OpenRouter), `AI_GATEWAY_API_KEY` (Vercel AI Gateway) or `OPENCODE_API_KEY` (OpenCode Zen) in your environment, or put it in `~/.spec.ai.jev/.env` as `KEY=value`; `spec setup` asks for a key and writes it there. spec.ai.jev reads that file as data and never prints it. The judge switches to the key by itself.
- **Another classifier** from pi's catalog: `/spec judge classifier:<provider>/<model>`, e.g. Cloudflare's Clef (`clef`, `clef-flash`) or a System One model on OpenRouter, with that provider's key.
- **CLM** (self-hosted; its encoder needs a GPU): start `clm-serve` from [Contrastive-LM/CLM](https://github.com/Contrastive-LM/CLM), then `/spec judge clm`. For a server on another machine, add `"judges": { "clm": { "type": "clm", "baseUrl": "http://<host>:8700" } }` to `~/.spec.ai.jev/agent/agent.json`. A server started with `CLM_API_KEY` needs the same value in `SPEC_AI_JEV_JUDGE_CLM_API_KEY`. `spec doctor` checks the server.
- **Laya** (local, macOS on Apple Silicon): `spec judge setup` installs it into `~/.spec.ai.jev/local-judge`. It downloads about 930 MB, only when you run that command.
- **Any model you already use:** `/spec judge llm:<provider>/<model>`.

Decisions take effect from the start (`active`). To only record what the judge would do: `/spec mode default shadow`, or `"modes": { "default": "shadow" }` in `~/.spec.ai.jev/agent/agent.json`.

## Commands

```text
spec.ai.jev                       interactive session in the current directory
spec.ai.jev "prompt"              interactive, starting with this prompt
spec.ai.jev -p "prompt"           one-shot: print the answer and exit
spec.ai.jev -c | -r               continue the last session | pick one to resume
spec setup [key]           connect a model and choose the judge (spec setup --help: scripts, the services)
spec judge <cmd>           the local judge (Laya): setup | start | stop | status | run
spec ledger [n] [--json]   what the judge decided in the last n sessions
spec doctor                check the installation
spec auth status           the subscription sign-in the desktop app uses (JSON lines)
spec import --list         Claude Code and Codex conversations on this computer
spec import <file>...      bring them into spec.ai.jev, to continue with /resume or spec.ai.jev --session
spec.ai.jev help | version
```

`spec --help` lists every flag of the agent. spec.ai.jev keeps its files in `~/.spec.ai.jev`, apart from a stock pi in `~/.pi`.

## Update and remove

```bash
npm i -g spec-ai-agent@latest
npm rm -g spec-ai-agent
```

Removing the package leaves `~/.spec.ai.jev` (your sessions, settings and logins) in place.

## License

MIT. pi is by Mario Zechner and contributors; third-party code in the judgment layer is listed in `judge/THIRD_PARTY_NOTICES.md`.
