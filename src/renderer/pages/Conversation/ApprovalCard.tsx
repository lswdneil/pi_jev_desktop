// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * A request the harness is blocked on, as a card.
 *
 * The agent is waiting: until this is answered, nothing runs. That is why the card is not dismissible and why the
 * stop button stays live — a person who thinks better of it cancels the run, and the pending question goes with it.
 * The answer travels back over the bridge as the protocol's own `extension_ui_response`.
 */

import { useState } from "react";
import type { MuApi } from "../../../shared/api.ts";
import type { PendingApproval } from "../../../shared/conversation.ts";

export function ApprovalCard({
	approval,
	api,
	onError,
	onAnswered,
	text,
}: {
	readonly approval: PendingApproval;
	readonly api: MuApi;
	readonly onError: (message: string) => void;
	/** The answer travels out, not in: the card takes itself down once the harness has it. */
	readonly onAnswered: (id: string) => void;
	readonly text: (key: string) => string;
}): React.JSX.Element {
	const [answerText, setAnswerText] = useState("");
	const [sending, setSending] = useState(false);

	const answer = (body: { value?: string; confirmed?: boolean; cancelled?: true }): void => {
		setSending(true);
		void api.harness
			.respond({ id: approval.id, ...body })
			.then(() => onAnswered(approval.id))
			.catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)))
			.finally(() => setSending(false));
	};

	return (
		<section className="panel approval" data-testid="approval" data-approval-method={approval.method}>
			<h2>{approval.title}</h2>
			{approval.message === undefined ? null : <p className="muted">{approval.message}</p>}

			{approval.method === "confirm" ? (
				<div className="row">
					<button type="button" data-testid="approval-allow" disabled={sending} onClick={() => answer({ confirmed: true })}>
						{text("approval.allow")}
					</button>
					<button type="button" data-testid="approval-deny" disabled={sending} onClick={() => answer({ confirmed: false })}>
						{text("approval.deny")}
					</button>
				</div>
			) : null}

			{approval.method === "select" ? (
				<div className="row">
					{(approval.options ?? []).map((option) => (
						<button key={option} type="button" data-testid="approval-option" disabled={sending} onClick={() => answer({ value: option })}>
							{option}
						</button>
					))}
					<button type="button" data-testid="approval-cancel" disabled={sending} onClick={() => answer({ cancelled: true })}>
						{text("approval.cancel")}
					</button>
				</div>
			) : null}

			{approval.method === "input" || approval.method === "editor" ? (
				<div className="row">
					<input
						type="text"
						value={answerText}
						placeholder={approval.placeholder ?? text("approval.placeholder")}
						onChange={(event) => setAnswerText(event.target.value)}
						data-testid="approval-input"
					/>
					<button type="button" data-testid="approval-submit" disabled={sending} onClick={() => answer({ value: answerText })}>
						{text("approval.send")}
					</button>
					<button type="button" data-testid="approval-cancel" disabled={sending} onClick={() => answer({ cancelled: true })}>
						{text("approval.cancel")}
					</button>
				</div>
			) : null}
		</section>
	);
}
