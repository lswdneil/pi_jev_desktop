# spec.ai.jev prototypes

Open `index.html` in a browser. The three views are clickable from the top switcher:

- **Workspace**: project, session, model, and the first task.
- **Running**: transcript, tool runs, board, and judgment trail.
- **Judgment**: an approval card with the reason it was raised.

The prototype uses the same Freebuff dark tokens as the app and the supplied spec.ai.jev logo. It is a design
reference, not production code.

## GUI review (2026-10-20)

`gui-v2.html` is the review draft for the component-system migration (`docs/design/2026-10-20-ui-stack.md`). One
layout, three visual directions, switchable from the top bar — A · Studio (recommended), B · Terminal, C · Editorial —
plus an empty-state toggle. Rendered stills live in `docs/design/mockups/`.

Open it directly; no server, no build, no network.
