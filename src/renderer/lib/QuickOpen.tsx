// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

/**
 * Quick open: Ctrl+P, a few letters, Enter.
 *
 * The list is the project's own files, so what a person types is a name rather than a path into the conversation. It
 * searches the folder the agent runs in, never the whole disk, and the file it opens lands in the Files panel, using
 * the same read and edit path as a file the agent touched.
 *
 * cmdk owns the roving selection, arrow keys and Enter. The search itself stays ours: the result order is the
 * project's ranking, so the runtime must not filter it a second time.
 */

import { Command } from "cmdk";
import { useEffect, useState } from "react";
import type { FileHit, SpecApi } from "../../shared/api.ts";

/** Typing is cheaper than walking a checkout; wait for a pause before asking. */
const DEBOUNCE_MS = 120;

export function QuickOpen({
	api,
	text,
	onOpen,
	onClose,
}: {
	readonly api: SpecApi;
	readonly text: (key: string) => string;
	readonly onOpen: (path: string) => void;
	readonly onClose: () => void;
}): React.JSX.Element {
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<readonly FileHit[]>([]);
	const [error, setError] = useState("");
	const [selected, setSelected] = useState("");

	useEffect(() => {
		if (query.trim() === "") {
			setHits([]);
			setSelected("");
			setError("");
			return;
		}
		let alive = true;
		const timer = setTimeout(() => {
			void api.workspace
				.searchFiles(query)
				.then((next) => {
					if (!alive) return;
					setHits(next);
					setSelected(next[0]?.path ?? "");
					setError("");
				})
				.catch((failure: unknown) => {
					if (alive) setError(failure instanceof Error ? failure.message : String(failure));
				});
		}, DEBOUNCE_MS);
		return () => {
			alive = false;
			clearTimeout(timer);
		};
	}, [api, query]);

	return (
		<div className="quick-open-backdrop" onMouseDown={onClose}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={text("quickOpen.title")}
				onMouseDown={(event) => event.stopPropagation()}
			>
				<Command
					shouldFilter={false}
					value={selected}
					onValueChange={setSelected}
					className="quick-open"
					data-testid="quick-open"
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							onClose();
						}
					}}
				>
					<Command.Input
						autoFocus
						value={query}
						onValueChange={setQuery}
						placeholder={text("quickOpen.placeholder")}
						aria-label={text("quickOpen.placeholder")}
						data-testid="quick-open-input"
					/>
					{error === "" ? null : <p className="line-error">{error}</p>}
					<Command.List className="quick-open-list" aria-label={text("quickOpen.results")}>
						<Command.Empty>
							<p className="muted">{text("quickOpen.empty")}</p>
						</Command.Empty>
						{hits.map((hit) => (
							<Command.Item
								key={hit.path}
								value={hit.path}
								onSelect={() => onOpen(hit.path)}
								className="quick-open-row cursor-pointer data-[selected=true]:border-primary data-[selected=true]:bg-secondary"
								data-testid="quick-open-hit"
							>
								<span className="quick-open-name">{hit.name}</span>
								<span className="quick-open-path">{hit.path}</span>
							</Command.Item>
						))}
					</Command.List>
				</Command>
			</div>
		</div>
	);
}
