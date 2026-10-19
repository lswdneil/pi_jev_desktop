// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

import { readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

export interface FilePreview {
	readonly path: string;
	readonly text: string;
	readonly truncated: boolean;
	readonly binary: boolean;
}

const MAX_BYTES = 1_000_000;

export function isPathInside(root: string, file: string): boolean {
	const base = resolve(root);
	const candidate = resolve(file);
	const a = process.platform === "win32" ? base.toLowerCase() : base;
	const b = process.platform === "win32" ? candidate.toLowerCase() : candidate;
	return b.startsWith(`${a}${sep}`);
}

export function readFilePreview(root: string, file: string): FilePreview {
	const path = resolve(file);
	if (!isPathInside(root, path)) throw new Error(`file is outside the current project: ${path}`);
	if (!statSync(path).isFile()) throw new Error(`not a file: ${path}`);
	const bytes = readFileSync(path);
	const head = bytes.subarray(0, MAX_BYTES);
	const binary = head.includes(0);
	return {
		path,
		text: binary ? "" : head.toString("utf8"),
		truncated: bytes.length > MAX_BYTES,
		binary,
	};
}
