// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

/** A file the panel has read, and the hash a save has to quote back. */
export interface FilePreview {
	readonly path: string;
	readonly text: string;
	readonly truncated: boolean;
	readonly binary: boolean;
	/**
	 * The file's sha256 at read time. A save quotes it back, so a write is refused rather than silently replacing what
	 * the agent wrote while the person had the file open.
	 */
	readonly hash: string;
	readonly size: number;
	/** False for binary and truncated files: the panel shows those, it does not let anyone edit them. */
	readonly editable: boolean;
}

/** What a save left on disk. */
export interface SavedFile {
	readonly path: string;
	readonly hash: string;
	readonly size: number;
}
