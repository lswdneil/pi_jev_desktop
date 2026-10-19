# spec.ai.jev product specification

Status: first vertical slice
Date: 2026-10-19

## Product thesis

Coding agents make hundreds of decisions that are not the code itself: what enters context, whether a command is
safe, whether a finding is worth sharing, and whether a turn is actually finished. A normal chat UI hides those
decisions until something goes wrong.

spec.ai.jev is a desktop workspace where the work and the judgment are visible together.

## User

The first user is a developer running a local coding agent across several project folders. They need to:

1. Open a project and start a task without leaving the app.
2. Change the model for the current session.
3. See what the agent is doing, which tools ran, and what changed.
4. Understand why an action was allowed, blocked, or escalated.
5. Return to the session and continue without losing the conversation.

## Product principles

- **Judgment is first-class.** The ledger is part of the main work surface, not only a debug tab.
- **One task, one clear workspace.** The project folder is visible before the first prompt.
- **Ask only at the boundary.** Ordinary steps stay quiet; approvals and irreversible actions get an explicit card.
- **Local-first.** Project files, sessions, keys, and the ledger stay on the machine by default.
- **The runtime is replaceable.** The desktop speaks the harness protocol; it does not import the harness internals.
- **One visual system.** Freebuff dark tokens apply to every surface.

## Information architecture

```text
┌──────────────┬──────────────────────────────┬──────────────────┐
│ Project      │ Current task                 │ Context          │
│              │                              │                  │
│ New task     │ Conversation + tool runs     │ Board            │
│              │                              │ Files            │
│ Workspace    │ Approval card when blocked   │ Judgments        │
│ Session      │                              │                  │
│              │ Composer + model             │                  │
│ Conversation │                              │                  │
│ Settings     │                              │                  │
└──────────────┴──────────────────────────────┴──────────────────┘
```

The left rail answers "where am I?" The center answers "what is happening?" The right panel answers "why should I
trust it?".

## First vertical slice

This release implements:

- A workspace chooser that restarts the harness in the selected folder.
- Recent-project shortcuts backed by local window storage.
- A session rail showing the current session, saved sessions, and model.
- Saved-session switching through the harness's `switch_session` command.
- Session search and renaming through `set_session_name`.
- A model picker backed by `get_available_models` / `set_model`.
- Conversation streaming, stop, new session, and history restoration.
- Tool execution rows, file changes, and the judgment ledger.
- A file preview with a line editor and a diff of the pending change. Saves are refused when the file changed on
  disk since it was read, and files outside the workspace, binaries and files past 1 MB stay read-only.
- A judgment drawer that shows what a ledger record carries (spec, mode, provider, time, source, request, id).
- Sessions from other projects in the rail: opening one moves the agent to that project's folder first, then switches
  to the session, so a conversation never comes back inside the wrong workspace.
- Recent projects with their folder path, and an `x` that forgets the shortcut without touching the folder.
- A log of the questions answered in the window. The harness keeps only the effect of an answer, so the window is the
  one place that can show what was asked and what was said.
- Images on a prompt: chosen, dropped or pasted, held as thumbnails, and sent with the text. The bridge takes PNG,
  JPEG, WebP and GIF only, at most six per message and 5 MB each.
- Approval cards for confirm, select, input, and editor requests.
- The spec.ai.jev logo and the Freebuff dark palette.

Acceptance path:

1. Launch spec.ai.jev.
2. Choose a project folder.
3. Choose a model.
4. Send a task.
5. Observe a tool run and a judgment record.
6. Restart or reopen the session and see the conversation restored.

## Data model

| Object | Meaning |
| --- | --- |
| `Project` | A folder the agent may work in. |
| `Session` | One durable conversation and its workspace. |
| `Turn` | One user request and the agent work that followed. |
| `Message` | User, assistant, or tool text shown in the transcript. |
| `ToolRun` | A tool name, arguments summary, status, and result. |
| `Approval` | A blocked UI request and the user's answer. |
| `Judgment` | A decision-point verdict, mode, provider, and reason. |
| `FileChange` | A path touched by a tool, with time and tool name. |

The first slice keeps the runtime session as the source of truth, indexes the session files in the app's agent folder,
and restores history through `get_messages`.

## Runtime boundary

```text
Renderer
  ↓ typed preload bridge
Electron main
  ↓ JSONL / line-delimited RPC
mu harness (pi + judgment kernel)
  ↓
model provider
```

The renderer never spawns a process, reads a file, or writes a session. The main process owns the supervisor and the
allow-listed bridge. The harness owns tool execution, model calls, and judgment semantics.

## Security

- Keep `contextIsolation`, `sandbox`, and `nodeIntegration: false`.
- Keep a fixed IPC channel list; no generic `invoke`.
- Keep CSP on every `app://` response.
- Validate prompt length, URLs, model ids, and UI answers before dispatch.
- Keep previews in a separate session with no permissions or downloads.
- Treat the project folder as a user-selected trust boundary, not as a place to silently write outside the workspace.

## Visual system

Freebuff dark is the baseline:

| Role | Value |
| --- | --- |
| Primary | `#9EFC62` |
| Foreground | `#f1f5f9` |
| Surface | `#202327` |
| Surface hover | `#334155` |
| Border | `#536175` |
| Muted | `#acb3bf` |
| Success | `#22c55e` |
| Warning | `#FFA500` |
| Error | `#ef4444` |
| Code background | `#374151` |
| Inline code | `#FF8534` |
| Heading | `#facc15` |

The logo is the supplied spec.ai.jev infinity mark. It is used in the rail and as the application icon.

## Non-goals for this slice

- Remote sessions and team collaboration.
- Signed installer and update installation.
- Full migration from the frozen `mu/desktop` AionUi profile.

These require their own specs and acceptance tests.

## Next slices

1. Signing key and update verification. The NSIS installer builds and is rehearsed end to end (silent install, a turn
   through a stub provider, uninstall); signing needs a certificate and the update key needs to be issued, neither of
   which a checkout can invent.
