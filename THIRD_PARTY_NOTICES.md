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

The mu/pi runtime source is vendored under `mu/` (MIT, `mu/LICENSE`), together with its own `desktop/`,
`desktop-next/`, `packages/` and `kyrn/` trees. It is maintained in this repository from 2026-10-20 onward; the app
launches the built harness and speaks its JSONL RPC protocol. The vendored tree keeps its upstream license and headers.
