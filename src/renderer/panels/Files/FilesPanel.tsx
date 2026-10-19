// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The files the conversation touched, newest first - and the one that is open.
 *
 * The list comes from the tool calls the agent made (a write, an edit, a patch): it is what this session changed, not
 * a diff of the working tree. A git status view belongs to a later panel; guessing one here would be wrong the moment
 * a person edits a file themselves.
 *
 * The editor is deliberately small. It reads a file, lets a line be changed, and shows what would be saved before it
 * is - which is the part a person cannot get from the agent's own diff, because it is about *their* edit. The write
 * quotes the hash the read returned, so a file the agent changed in between is a conflict to look at, never a silent
 * overwrite.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { FilePreview, MuApi } from "../../../shared/api.ts";
import type { ChangedFile } from "../../../shared/conversation.ts";
import { diffLines } from "../../../shared/diff.ts";

/** A 1 MB file can produce tens of thousands of rows; the panel shows the start and says so. */
const MAX_DIFF_ROWS = 400;

function size(text: string): string {
	const bytes = new TextEncoder().encode(text).length;
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FilesPanel({
	files,
	api,
	text,
	openFile,
}: {
	readonly files: readonly ChangedFile[];
	readonly api: MuApi;
	readonly text: (key: string) => string;
	/** A file quick-open asked for; its nonce changes on every request so the same file can be reopened. */
	readonly openFile: { readonly path: string; readonly nonce: number } | undefined;
}): React.JSX.Element {
	const newest = files.slice().reverse().slice(0, 40);
	const [selected, setSelected] = useState<string | undefined>(undefined);
	const [preview, setPreview] = useState<FilePreview | undefined>(undefined);
	const [draft, setDraft] = useState<string | undefined>(undefined);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [conflict, setConflict] = useState(false);

	const dirty = preview !== undefined && draft !== undefined && draft !== preview.text;
	const diff = useMemo(
		() => (preview !== undefined && draft !== undefined && dirty ? diffLines(preview.text, draft) : undefined),
		[preview, draft, dirty],
	);

	const open = (path: string): void => {
		setSelected(path);
		setPreview(undefined);
		setDraft(undefined);
		setError("");
		setSaved(false);
		setConflict(false);
		setLoading(true);
		void api.workspace
			.readFile(path)
			.then(setPreview)
			.catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
			.finally(() => setLoading(false));
	};

	const openedNonce = useRef<number | undefined>(undefined);
	useEffect(() => {
		if (openFile === undefined || openedNonce.current === openFile.nonce) return;
		openedNonce.current = openFile.nonce;
		open(openFile.path);
	}, [openFile]);

	const close = (): void => {
		setSelected(undefined);
		setPreview(undefined);
		setDraft(undefined);
		setError("");
		setSaved(false);
		setConflict(false);
	};

	const save = (): void => {
		if (selected === undefined || preview === undefined || draft === undefined || !dirty || saving) return;
		setSaving(true);
		setError("");
		setConflict(false);
		void api.workspace
			.saveFile(selected, draft, preview.hash)
			.then((written) => {
				setPreview({ ...preview, text: draft, hash: written.hash, size: written.size, truncated: false });
				setDraft(undefined);
				setSaved(true);
			})
			.catch((failure: unknown) => {
				const message = failure instanceof Error ? failure.message : String(failure);
				setConflict(message.includes("conflict:"));
				setError(message);
			})
			.finally(() => setSaving(false));
	};

	const rows = diff?.rows.slice(0, MAX_DIFF_ROWS) ?? [];

	return (
		<section className="panel" data-testid="files-panel">
			<h2>{text("panel.files")}</h2>
			{newest.length === 0 ? (
				<p className="muted">{text("panel.noFiles")}</p>
			) : (
				<ul className="files">
					{newest.map((file, index) => (
						<li key={`${file.path}-${index}`} data-file={file.path}>
							<button
								type="button"
								className={`file-row${file.path === selected ? " active" : ""}`}
								onClick={() => open(file.path)}
								title={file.path}
							>
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
						{preview === undefined ? null : <span className="muted file-size">{size(preview.text)}</span>}
						<button type="button" aria-label={text("panel.closePreview")} onClick={close}>
							×
						</button>
					</div>
					{loading ? <p className="muted">{text("panel.loadingFile")}</p> : null}
					{error === "" ? null : <p className="line-error">{error}</p>}
					{conflict ? (
						<button type="button" data-testid="file-reload" onClick={() => open(selected)}>
							{text("panel.reload")}
						</button>
					) : null}
					{preview?.binary === true ? <p className="muted">{text("panel.binaryFile")}</p> : null}
					{preview?.truncated === true ? <p className="muted">{text("panel.truncatedFile")}</p> : null}

					{preview === undefined || preview.binary ? null : draft === undefined ? (
						<>
							{preview.editable ? (
								<p className="row file-actions">
									<button type="button" data-testid="file-edit" onClick={() => setDraft(preview.text)}>
										{text("panel.editFile")}
									</button>
									{saved ? <span className="muted">{text("panel.saved")}</span> : null}
								</p>
							) : null}
							<pre>{preview.text}</pre>
						</>
					) : (
						<>
							<textarea
								className="file-editor"
								data-testid="file-editor"
								value={draft}
								spellCheck={false}
								onChange={(event) => {
									setDraft(event.target.value);
									setSaved(false);
								}}
								onKeyDown={(event) => {
									if ((event.ctrlKey || event.metaKey) && event.key === "s") {
										event.preventDefault();
										save();
									}
								}}
							/>
							<p className="row file-actions">
								<button type="button" data-testid="file-save" disabled={!dirty || saving} onClick={save}>
									{text("panel.saveFile")}
								</button>
								<button type="button" data-testid="file-cancel" disabled={saving} onClick={() => setDraft(undefined)}>
									{text("app.cancel")}
								</button>
								<span className="muted">{dirty ? text("panel.diff") : text("panel.noChanges")}</span>
							</p>
						</>
					)}

					{diff === undefined ? null : (
						<div className="diff" data-testid="file-diff">
							<p className="row diff-counts">
								<span className="diff-add">+{diff.added}</span>
								<span className="diff-remove">-{diff.removed}</span>
								{diff.tooLarge ? <span className="muted">{text("panel.diffTooLarge")}</span> : null}
							</p>
							<div className="diff-rows">
								{rows.map((row, index) => (
									<div key={index} className={`diff-row diff-${row.kind}`}>
										<span className="diff-num">{row.before ?? ""}</span>
										<span className="diff-num">{row.after ?? ""}</span>
										<span className="diff-sign">{row.kind === "add" ? "+" : row.kind === "remove" ? "-" : " "}</span>
										<span className="diff-text">{row.text}</span>
									</div>
								))}
							</div>
							{diff.rows.length > rows.length ? <p className="muted">{text("panel.diffTruncated")}</p> : null}
						</div>
					)}
				</div>
			)}
		</section>
	);
}
