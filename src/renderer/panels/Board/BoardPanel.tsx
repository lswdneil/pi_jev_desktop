// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The board: what the agent is doing now, and what it just did.
 *
 * Its data comes from the conversation reducer (turns and tool calls), and nothing else: a panel that also owned the
 * conversation would be the shared context the old shell grew to 1,396 lines.
 */

import { ListChecks } from "lucide-react";
import { type BoardState, waitingTitle } from "../../../shared/conversation.ts";
import { Badge } from "../../ui/badge.tsx";

export function BoardPanel({
	board,
	text,
}: {
	readonly board: BoardState;
	readonly text: (key: string) => string;
}): React.JSX.Element {
	const waiting = waitingTitle(board.current);
	const state = waiting !== undefined ? "waiting" : board.current === undefined ? "idle" : "working";
	const steps = board.steps.slice().reverse().slice(0, 8);
	return (
		<section className="panel" data-testid="board-panel">
			<header className="panel-head">
				<h2>{text("panel.board")}</h2>
				<Badge variant="secondary">
					{text("panel.turn")} {board.turn}
				</Badge>
			</header>
			<div className="board-status" data-state={state} data-testid="board-current">
				<span className="board-dot" aria-hidden="true" />
				<span className="board-state">
					{board.current === undefined ? (
						<span className="muted">{text("panel.idle")}</span>
					) : waiting !== undefined ? (
						<strong>
							{text("panel.waiting")}: {waiting}
						</strong>
					) : (
						<strong>{board.current === "thinking" ? text("panel.thinking") : board.current}</strong>
					)}
				</span>
			</div>
			{steps.length === 0 ? (
				<p className="panel-empty">
					<ListChecks aria-hidden="true" />
					{text("panel.noSteps")}
				</p>
			) : (
				<>
					<p className="panel-label">{text("panel.recentSteps")}</p>
					<ol className="board-steps" data-testid="board-steps">
						{steps.map((step, index) => (
							<li key={`${step}-${index}`}>{step}</li>
						))}
					</ol>
				</>
			)}
		</section>
	);
}
