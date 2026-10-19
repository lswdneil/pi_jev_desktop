// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The judgments, from mu's ledger.
 *
 * Its data source is `mu ledger --json`, the command the kernel already ships for exactly this: the ledger's format
 * stays the kernel's business, and this panel is a reader. The list refreshes on demand and every few seconds while it
 * is open, which is enough for a person watching decisions land.
 */

import { useCallback, useEffect, useState } from "react";
import type { JudgmentRecord, MuApi } from "../../../shared/api.ts";

const REFRESH_MS = 3_000;

export function JudgmentsPanel({
	api,
	text,
}: {
	readonly api: MuApi;
	readonly text: (key: string) => string;
}): React.JSX.Element {
	const [records, setRecords] = useState<readonly JudgmentRecord[]>([]);
	const [error, setError] = useState("");

	const load = useCallback(() => {
		void api.judgments
			.recent()
			.then((loaded) => {
				setRecords(loaded);
				setError("");
			})
			.catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
	}, [api]);

	useEffect(() => {
		load();
		const timer = setInterval(load, REFRESH_MS);
		return () => clearInterval(timer);
	}, [load]);

	const newest = records.slice().reverse().slice(0, 30);
	return (
		<section className="panel" data-testid="judgments-panel">
			<h2>{text("panel.judgments")}</h2>
			{error === "" ? null : <p className="line-error">{error}</p>}
			{newest.length === 0 ? (
				<p className="muted">{text("panel.noDecisions")}</p>
			) : (
				<>
					<p className="muted" data-testid="judgments-count">
						{records.length} {text("panel.decisions")}
					</p>
					<ul className="judgments">
						{newest.map((record) => (
							<li key={record.id} data-judgment={record.id}>
								<code>{record.specId}</code>{" "}
								<span className={`chip chip-${record.mode === "active" ? "running" : "stopped"}`}>{record.mode}</span>{" "}
								<span className="muted">{record.providerId}</span>
								{record.userMessage === undefined ? null : <div className="muted">{record.userMessage}</div>}
							</li>
						))}
					</ul>
				</>
			)}
		</section>
	);
}
