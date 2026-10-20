// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

/**
 * Quick open and the command palette: Ctrl+P / Ctrl+K, a few letters, Enter.
 *
 * Files come from the project's own search; actions and sessions come from the window. cmdk owns the roving
 * selection, arrow keys and Enter, while the ranking and filtering stay here so the palette never asks the file
 * search for a query it did not type.
 */

import { Command } from "cmdk";
import { useEffect, useState, type ReactNode } from "react";
import type { FileHit, SpecApi } from "../../shared/api.ts";

/** Typing is cheaper than walking a checkout; wait for a pause before asking. */
const DEBOUNCE_MS = 120;

export interface PaletteItem {
	readonly id: string;
	readonly label: string;
	readonly hint?: string;
	readonly icon?: ReactNode;
	readonly group: "action" | "session";
	readonly run: () => void;
}

export function QuickOpen({
	api,
	text,
	items,
	onOpen,
	onClose,
}: {
	readonly api: SpecApi;
	readonly text: (key: string) => string;
	readonly items: readonly PaletteItem[];
	readonly onOpen: (path: string) => void;
	readonly onClose: () => void;
}): React.JSX.Element {
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<readonly FileHit[]>([]);
	const [error, setError] = useState("");
	const [selected, setSelected] = useState("");

	const needle = query.trim().toLowerCase();
	const visibleItems = items.filter(
		(item) => needle === "" || `${item.label} ${item.hint ?? ""}`.toLowerCase().includes(needle),
	);
	const actions = visibleItems.filter((item) => item.group === "action");
	const sessions = visibleItems.filter((item) => item.group === "session");
	// cmdk owns the roving selection; this effect only repairs it when the list under it changes shape. The
	// signature keeps re-renders with the same rows from resetting a selection the keyboard just made.
	const available = [...visibleItems.map((item) => item.id), ...hits.map((hit) => `file:${hit.path}`)];
	const signature = available.join("\u0000");

	useEffect(() => {
		setSelected((current) => (available.includes(current) ? current : (available[0] ?? "")));
	}, [signature]);

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

	const select = (run: () => void): void => {
		run();
		onClose();
	};

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
						{actions.length === 0 ? null : (
							<Command.Group heading={text("quickOpen.actions")}>
								{actions.map((item) => (
									<Command.Item
										key={item.id}
										value={item.id}
										onSelect={() => select(item.run)}
										className="quick-open-row cursor-pointer data-[selected=true]:border-primary data-[selected=true]:bg-secondary"
										data-testid="quick-open-action"
									>
										<span className="quick-open-name flex items-center gap-2">
											{item.icon}
											{item.label}
										</span>
										{item.hint === undefined ? null : <span className="quick-open-path">{item.hint}</span>}
									</Command.Item>
								))}
							</Command.Group>
						)}
						{sessions.length === 0 ? null : (
							<Command.Group heading={text("quickOpen.sessions")}>
								{sessions.map((item) => (
									<Command.Item
										key={item.id}
										value={item.id}
										onSelect={() => select(item.run)}
										className="quick-open-row cursor-pointer data-[selected=true]:border-primary data-[selected=true]:bg-secondary"
										data-testid="quick-open-session"
									>
										<span className="quick-open-name">{item.label}</span>
										{item.hint === undefined ? null : <span className="quick-open-path">{item.hint}</span>}
									</Command.Item>
								))}
							</Command.Group>
						)}
						{hits.length === 0 ? null : (
							<Command.Group heading={text("quickOpen.files")}>
								{hits.map((hit) => (
									<Command.Item
										key={hit.path}
										value={`file:${hit.path}`}
										onSelect={() => select(() => onOpen(hit.path))}
										className="quick-open-row cursor-pointer data-[selected=true]:border-primary data-[selected=true]:bg-secondary"
										data-testid="quick-open-hit"
									>
										<span className="quick-open-name">{hit.name}</span>
										<span className="quick-open-path">{hit.path}</span>
									</Command.Item>
								))}
							</Command.Group>
						)}
					</Command.List>
					<p className="quick-open-footer" data-testid="quick-open-hint" aria-hidden="true">
						{text("quickOpen.hint")}
					</p>
				</Command>
			</div>
		</div>
	);
}
