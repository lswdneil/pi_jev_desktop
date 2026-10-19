// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The files the conversation touched, newest first.
 *
 * The list comes from the tool calls the agent made (a write, an edit, a patch): it is what this session changed, not
 * a diff of the working tree. A git status view belongs to a later panel; guessing one here would be wrong the moment
 * a person edits a file themselves.
 */

import type { ChangedFile } from "../../../shared/conversation.ts";

export function FilesPanel({
	files,
	text,
}: {
	readonly files: readonly ChangedFile[];
	readonly text: (key: string) => string;
}): React.JSX.Element {
	const newest = files.slice().reverse().slice(0, 40);
	return (
		<section className="panel" data-testid="files-panel">
			<h2>{text("panel.files")}</h2>
			{newest.length === 0 ? (
				<p className="muted">{text("panel.noFiles")}</p>
			) : (
				<ul className="files">
					{newest.map((file, index) => (
						<li key={`${file.path}-${index}`} data-file={file.path}>
							<code>{file.path}</code> <span className="muted">{file.tool}</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
