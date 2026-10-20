# Third-party notices

## mu desktop-next

The Electron main process, preload bridge, renderer foundation, and test harness are derived from the mu desktop-next
shell (Apache-2.0). The copied files retain their `SPDX-License-Identifier: Apache-2.0` headers. The full license is
in `LICENSES/Apache-2.0.txt`.

## Freebuff

The dark theme values are adapted from Freebuff's public CLI theme system:

- primary `#9EFC62`
- foreground `#f1f5f9`
- surface `#202327`
- surface hover `#334155`
- border `#536175`
- code background `#374151`
- inline code `#FF8534`
- headings `#facc15`

Freebuff is Apache-2.0. No Freebuff application code is bundled; only color values were used as a visual reference.

## pi / mu

The mu/pi runtime source is vendored under `spec.ai.jev/` (MIT, `spec.ai.jev/LICENSE`), together with its
`packages/`, `kyrn/`, `scripts/` and `docs/` trees. It is maintained in this repository from 2026-10-20 onward; the app
launches the built harness and speaks its JSONL RPC protocol. The vendored tree keeps its upstream license and headers.

## Desktop UI

The renderer's base controls follow the shadcn/ui patterns (MIT) and use Radix UI primitives (MIT). Tailwind CSS
(MIT) provides the utility layer, `class-variance-authority` (Apache-2.0), `clsx` (MIT) and `tailwind-merge` (MIT)
build the component variants, and `lucide-react` (ISC) supplies the icons. The copied shadcn files live in
`src/renderer/ui/` and keep a source comment at the top.

The conversation runtime and composer use assistant-ui (`@assistant-ui/react` and the core packages
`@assistant-ui/core`, `@assistant-ui/store`, `@assistant-ui/tap`, and `assistant-stream`; all MIT) for the
external-store runtime, message model, composer state and attachments. Zustand (MIT) is their state store. The
product keeps its own `ConversationStore`; assistant-ui only runs the view state.

Quick open uses cmdk (MIT), error notices use sonner (MIT), the resizable workspace uses
react-resizable-panels (MIT), and code blocks are tokenized by Shiki (MIT). Shiki grammars load on demand and
are rendered as React spans, never as HTML strings.
