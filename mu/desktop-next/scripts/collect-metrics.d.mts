// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * Types for `collect-metrics.mjs`, which the unit test imports.
 *
 * The script is plain JavaScript (it runs under `node`, not through the app's build), so this is the only place its
 * shape is declared for the type checker. Keep it to what a test may use: the collector's own entry point stays the
 * command line.
 */

/** What one process of the app's tree is for: a Chromium role from its command line, else the shell or the harness. */
export function roleOf(command: string): string;
