// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

/**
 * Quick open: Ctrl+P, a few letters, Enter.
 *
 * The list is the project's own files, so what a person types is a name rather than a path into the conversation. It
 * searches the folder the agent runs in, never the whole disk, and the file it opens lands in the Files panel, using
 * the same read and edit path as a file the agent touched.
 */

import { useEffect, useRef, useState } from "react";
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
	const [active, setActive] = useState(0);
	const listRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (query.trim() === "") {
			setHits([]);
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
					setActive(0);
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

	// Keep the highlighted row in view while the arrow keys move it.
	useEffect(() => {
		listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
	}, [active, hits]);

	return (
		<div className="quick-open-backdrop" onMouseDown={onClose}>
			<div
				className="quick-open"
				role="dialog"
				aria-modal="true"
				aria-label={text("quickOpen.title")}
				data-testid="quick-open"
				onMouseDown={(event) => event.stopPropagation()}
			>
				<input
					autoFocus
					type="text"
					value={query}
					placeholder={text("quickOpen.placeholder")}
					aria-label={text("quickOpen.placeholder")}
					data-testid="quick-open-input"
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							onClose();
						} else if (event.key === "ArrowDown") {
							event.preventDefault();
							setActive((current) => (hits.length === 0 ? 0 : (current + 1) % hits.length));
						} else if (event.key === "ArrowUp") {
							event.preventDefault();
							setActive((current) => (hits.length === 0 ? 0 : (current - 1 + hits.length) % hits.length));
						} else if (event.key === "Enter") {
							event.preventDefault();
							const hit = hits[active];
							if (hit !== undefined) onOpen(hit.path);
						}
					}}
				/>
				{error === "" ? null : <p className="line-error">{error}</p>}
				<div className="quick-open-list" ref={listRef} role="listbox" aria-label={text("quickOpen.results")}>
					{query.trim() !== "" && hits.length === 0 && error === "" ? (
						<p className="muted">{text("quickOpen.empty")}</p>
					) : null}
					{hits.map((hit, index) => (
						<button
							key={hit.path}
							type="button"
							role="option"
							aria-selected={index === active}
							className={`quick-open-row${index === active ? " active" : ""}`}
							data-testid="quick-open-hit"
							onClick={() => onOpen(hit.path)}
							onMouseEnter={() => setActive(index)}
						>
							<span className="quick-open-name">{hit.name}</span>
							<span className="quick-open-path">{hit.path}</span>
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
