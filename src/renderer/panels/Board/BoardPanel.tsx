// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The board: what the agent is doing now, and what it just did.
 *
 * Its data comes from the conversation reducer (turns and tool calls), and nothing else: a panel that also owned the
 * conversation would be the shared context the old shell grew to 1,396 lines.
 */

import { type BoardState, waitingTitle } from "../../../shared/conversation.ts";

export function BoardPanel({
	board,
	text,
}: {
	readonly board: BoardState;
	readonly text: (key: string) => string;
}): React.JSX.Element {
	const waiting = waitingTitle(board.current);
	return (
		<section className="panel" data-testid="board-panel">
			<h2>{text("panel.board")}</h2>
			<p data-testid="board-current">
				{board.current === undefined ? (
					<span className="muted">{text("panel.idle")}</span>
				) : waiting !== undefined ? (
					<strong>
						{text("panel.waiting")}: {waiting}
					</strong>
				) : (
					<strong>{board.current === "thinking" ? text("panel.thinking") : board.current}</strong>
				)}
			</p>
			<p className="muted">
				{text("panel.turn")} {board.turn}
			</p>
			{board.steps.length === 0 ? null : (
				<ol className="steps" data-testid="board-steps">
					{board.steps
						.slice()
						.reverse()
						.slice(0, 8)
						.map((step, index) => (
							<li key={`${step}-${index}`}>{step}</li>
						))}
				</ol>
			)}
		</section>
	);
}
