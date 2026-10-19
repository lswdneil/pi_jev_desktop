// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

import { closeSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { FilePreview, SavedFile } from "../shared/files.ts";

export type { FilePreview, SavedFile };

/** The file on disk is not the one the edit started from. The panel answers this by offering a reload. */
export class FileConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FileConflictError";
	}
}

const MAX_BYTES = 1_000_000;

export function isPathInside(root: string, file: string): boolean {
	const base = resolve(root);
	const candidate = resolve(file);
	const a = process.platform === "win32" ? base.toLowerCase() : base;
	const b = process.platform === "win32" ? candidate.toLowerCase() : candidate;
	return b.startsWith(`${a}${sep}`);
}

function sha256(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** The first `MAX_BYTES` of a file, without ever holding the whole thing. A 2 GB log is previewed as 1 MB. */
function readHead(path: string, size: number): Buffer {
	const length = Math.min(size, MAX_BYTES);
	if (length === 0) return Buffer.alloc(0);
	const buffer = Buffer.alloc(length);
	const handle = openSync(path, "r");
	try {
		const read = readSync(handle, buffer, 0, length, 0);
		return read === length ? buffer : buffer.subarray(0, read);
	} finally {
		closeSync(handle);
	}
}

export function readFilePreview(root: string, file: string): FilePreview {
	// The agent names files relative to its working directory; the app's own cwd is wherever Electron was started.
	const path = resolve(root, file);
	if (!isPathInside(root, path)) throw new Error(`file is outside the current project: ${path}`);
	const stats = statSync(path);
	if (!stats.isFile()) throw new Error(`not a file: ${path}`);
	const truncated = stats.size > MAX_BYTES;
	const bytes = readHead(path, stats.size);
	const binary = bytes.includes(0);
	const editable = !truncated && !binary;
	return {
		path,
		text: binary ? "" : bytes.toString("utf8"),
		truncated,
		binary,
		hash: editable ? sha256(bytes) : "",
		size: stats.size,
		editable,
	};
}

/**
 * Keep the file's line endings.
 *
 * A textarea hands back `\n` whatever went in; writing that over a CRLF file turns one edited line into a whole-file
 * diff in git. The original decides: CRLF in, CRLF out.
 */
export function matchLineEndings(original: string, edited: string): string {
	const newlines = (original.match(/\n/g) ?? []).length;
	const crlf = (original.match(/\r\n/g) ?? []).length;
	if (crlf === 0 || crlf * 2 < newlines) return edited;
	if (edited.includes("\r")) return edited;
	return edited.replace(/\n/g, "\r\n");
}

/** Write beside the file, then move it into place: a crash or a full disk leaves the old contents, not half of both. */
function writeAtomic(path: string, body: Buffer): void {
	const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
	try {
		writeFileSync(temp, body);
		renameSync(temp, path);
	} catch (error) {
		rmSync(temp, { force: true });
		throw error;
	}
}

export function saveFile(root: string, file: string, text: string, expectedHash: string): SavedFile {
	const path = resolve(root, file);
	if (!isPathInside(root, path)) throw new Error(`file is outside the current project: ${path}`);
	const stats = statSync(path);
	if (!stats.isFile()) throw new Error(`not a file: ${path}`);
	if (stats.size > MAX_BYTES) throw new Error(`the file is larger than ${MAX_BYTES} bytes and is not edited here: ${path}`);
	if (expectedHash === "") throw new Error("a save needs the hash of the file it read");

	const current = readFileSync(path);
	if (current.includes(0)) throw new Error(`not a text file: ${path}`);
	if (sha256(current) !== expectedHash) throw new FileConflictError(`the file changed on disk since it was read: ${path}`);

	const body = Buffer.from(matchLineEndings(current.toString("utf8"), text), "utf8");
	if (body.length > MAX_BYTES) throw new Error(`the edited file would be larger than ${MAX_BYTES} bytes`);
	writeAtomic(path, body);
	return { path, hash: sha256(body), size: body.length };
}
