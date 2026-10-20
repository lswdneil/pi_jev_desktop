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
import { Button } from "../../ui/button.tsx";
import { Input } from "../../ui/input.tsx";
import type { SpecApi } from "../../../shared/api.ts";
import type { PendingApproval } from "../../../shared/conversation.ts";

export function ApprovalCard({
	approval,
	api,
	onError,
	onAnswered,
	text,
}: {
	readonly approval: PendingApproval;
	readonly api: SpecApi;
	readonly onError: (message: string) => void;
	/** The answer travels out, not in: the card takes itself down once the harness has it. */
	readonly onAnswered: (approval: PendingApproval, answer: string) => void;
	readonly text: (key: string) => string;
}): React.JSX.Element {
	const [answerText, setAnswerText] = useState("");
	const [sending, setSending] = useState(false);

	const answer = (body: { value?: string; confirmed?: boolean; cancelled?: true }): void => {
		// The label is what the session log keeps: the harness only keeps the effect of the answer.
		const label = body.cancelled === true ? "cancelled" : body.confirmed === true ? "allowed" : body.confirmed === false ? "denied" : (body.value ?? "");
		setSending(true);
		void api.harness
			.respond({ id: approval.id, ...body })
			.then(() => onAnswered(approval, label))
			.catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)))
			.finally(() => setSending(false));
	};

	return (
		<section className="panel approval" data-testid="approval" data-approval-method={approval.method}>
			<h2>{approval.title}</h2>
			{approval.message === undefined ? null : <p className="muted">{approval.message}</p>}

			{approval.method === "confirm" ? (
				<div className="flex flex-wrap items-center gap-2">
					<Button type="button" data-testid="approval-allow" disabled={sending} onClick={() => answer({ confirmed: true })}>
						{text("approval.allow")}
					</Button>
					<Button type="button" variant="outline" data-testid="approval-deny" disabled={sending} onClick={() => answer({ confirmed: false })}>
						{text("approval.deny")}
					</Button>
				</div>
			) : null}

			{approval.method === "select" ? (
				<div className="flex flex-wrap items-center gap-2">
					{(approval.options ?? []).map((option) => (
						<Button key={option} type="button" variant="secondary" data-testid="approval-option" disabled={sending} onClick={() => answer({ value: option })}>
							{option}
						</Button>
					))}
					<Button type="button" variant="ghost" data-testid="approval-cancel" disabled={sending} onClick={() => answer({ cancelled: true })}>
						{text("approval.cancel")}
					</Button>
				</div>
			) : null}

			{approval.method === "input" || approval.method === "editor" ? (
				<div className="flex flex-wrap items-center gap-2">
					<Input
						type="text"
						value={answerText}
						placeholder={approval.placeholder ?? text("approval.placeholder")}
						onChange={(event) => setAnswerText(event.target.value)}
						className="min-w-[14rem] flex-1"
						data-testid="approval-input"
					/>
					<Button type="button" data-testid="approval-submit" disabled={sending} onClick={() => answer({ value: answerText })}>
						{text("approval.send")}
					</Button>
					<Button type="button" variant="ghost" data-testid="approval-cancel" disabled={sending} onClick={() => answer({ cancelled: true })}>
						{text("approval.cancel")}
					</Button>
				</div>
			) : null}
		</section>
	);
}
