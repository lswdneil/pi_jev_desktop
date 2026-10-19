// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The files the conversation touched, newest first.
 *
 * The list comes from the tool calls the agent made (a write, an edit, a patch): it is what this session changed, not
 * a diff of the working tree. A git status view belongs to a later panel; guessing one here would be wrong the moment
 * a person edits a file themselves.
 */

import { useState } from "react";
import type { FilePreview, MuApi } from "../../../shared/api.ts";
import type { ChangedFile } from "../../../shared/conversation.ts";

export function FilesPanel({
	files,
	api,
	text,
}: {
	readonly files: readonly ChangedFile[];
	readonly api: MuApi;
	readonly text: (key: string) => string;
}): React.JSX.Element {
	const newest = files.slice().reverse().slice(0, 40);
	const [selected, setSelected] = useState<string | undefined>(undefined);
	const [preview, setPreview] = useState<FilePreview | undefined>(undefined);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	const open = (path: string): void => {
		setSelected(path);
		setPreview(undefined);
		setError("");
		setLoading(true);
		void api.workspace
			.readFile(path)
			.then(setPreview)
			.catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
			.finally(() => setLoading(false));
	};

	return (
		<section className="panel" data-testid="files-panel">
			<h2>{text("panel.files")}</h2>
			{newest.length === 0 ? (
				<p className="muted">{text("panel.noFiles")}</p>
			) : (
				<ul className="files">
					{newest.map((file, index) => (
						<li key={`${file.path}-${index}`} data-file={file.path}>
							<button type="button" className="file-row" onClick={() => open(file.path)} title={file.path}>
								<code>{file.path}</code> <span className="muted">{file.tool}</span>
							</button>
						</li>
					))}
				</ul>
			)}
			{selected === undefined ? null : (
				<div className="file-preview" data-testid="file-preview">
					<div className="file-preview-head">
						<code>{selected}</code>
						<button type="button" aria-label={text("panel.closePreview")} onClick={() => setSelected(undefined)}>
							×
						</button>
					</div>
					{loading ? <p className="muted">{text("panel.loadingFile")}</p> : null}
					{error === "" ? null : <p className="line-error">{error}</p>}
					{preview?.binary === true ? <p className="muted">{text("panel.binaryFile")}</p> : null}
					{preview?.truncated === true ? <p className="muted">{text("panel.truncatedFile")}</p> : null}
					{preview === undefined || preview.binary ? null : <pre>{preview.text}</pre>}
				</div>
			)}
		</section>
	);
}
