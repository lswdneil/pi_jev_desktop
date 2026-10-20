// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The judgments, from spec.ai.jev's ledger.
 *
 * Its data source is `spec ledger --json`, the command the kernel already ships for exactly this: the ledger's format
 * stays the kernel's business, and this panel is a reader. The list refreshes on demand and every few seconds while it
 * is open, which is enough for a person watching decisions land.
 */

import { useCallback, useEffect, useState } from "react";
import { Copy, Scale } from "lucide-react";
import type { JudgmentRecord, SpecApi } from "../../../shared/api.ts";
import { Badge } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";

const REFRESH_MS = 3_000;

export function JudgmentsPanel({
	api,
	text,
}: {
	readonly api: SpecApi;
	readonly text: (key: string) => string;
}): React.JSX.Element {
	const [records, setRecords] = useState<readonly JudgmentRecord[]>([]);
	const [error, setError] = useState("");
	const [selected, setSelected] = useState<string | undefined>(undefined);
	const [copied, setCopied] = useState(false);

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
	const detail = newest.find((record) => record.id === selected);
	return (
		<section className="panel" data-testid="judgments-panel">
			<header className="panel-head">
				<h2>{text("panel.judgments")}</h2>
			</header>
			{error === "" ? null : <p className="line-error">{error}</p>}
			{newest.length === 0 ? (
				<p className="panel-empty">
					<Scale aria-hidden="true" />
					{text("panel.noDecisions")}
				</p>
			) : (
				<>
					<p className="panel-sub" data-testid="judgments-count">
						{records.length} {text("panel.decisions")}
					</p>
					<ul className="judgments">
						{newest.map((record) => (
							<li key={record.id} data-judgment={record.id}>
								<Button
									type="button"
									variant="ghost"
									className={`judgment-row h-auto w-full items-stretch justify-start whitespace-normal${record.id === selected ? " active" : ""}`}
									onClick={() => {
										setSelected(record.id === selected ? undefined : record.id);
										setCopied(false);
									}}
								>
									<span className="judgment-top">
										<code className="judgment-spec">{record.specId}</code>
										<Badge variant={record.mode === "active" ? "default" : "secondary"}>{record.mode}</Badge>
										<span className="judgment-provider">{record.providerId}</span>
									</span>
									{record.userMessage === undefined ? null : (
										<span className="judgment-message">{record.userMessage}</span>
									)}
								</Button>
								{record.id === selected && detail !== undefined ? (
									<dl className="judgment-detail" data-testid="judgment-detail">
										<dt>{text("panel.spec")}</dt>
										<dd>
											<code>{detail.specId}</code>
										</dd>
										<dt>{text("panel.mode")}</dt>
										<dd>{detail.mode}</dd>
										<dt>{text("panel.provider")}</dt>
										<dd>{detail.providerId}</dd>
										{detail.timestamp === undefined ? null : (
											<>
												<dt>{text("panel.time")}</dt>
												<dd>{detail.timestamp}</dd>
											</>
										)}
										{detail.source === undefined ? null : (
											<>
												<dt>{text("panel.source")}</dt>
												<dd>{detail.source}</dd>
											</>
										)}
										{detail.userMessage === undefined ? null : (
											<>
												<dt>{text("panel.message")}</dt>
												<dd>{detail.userMessage}</dd>
											</>
										)}
										<dt>{text("panel.id")}</dt>
										<dd>
											<code>{detail.id}</code>{" "}
											<Button
												type="button"
												variant="outline"
												size="sm"
												data-testid="judgment-copy"
												onClick={() => {
													void api.app.copy(detail.id).then(() => setCopied(true));
												}}
											>
												<Copy />
												{copied ? text("panel.copied") : text("panel.copyId")}
											</Button>
										</dd>
									</dl>
								) : null}
							</li>
						))}
					</ul>
				</>
			)}
		</section>
	);
}
