// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The board: what the agent is doing now, and what it just did.
 *
 * Its data comes from the conversation reducer (turns and tool calls), and nothing else: a panel that also owned the
 * conversation would be the shared context the old shell grew to 1,396 lines.
 */

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
	return (
		<section className="panel" data-testid="board-panel">
			<div className="mb-3 flex items-center justify-between gap-3">
				<h2 className="m-0">{text("panel.board")}</h2>
				<Badge variant="secondary">
					{text("panel.turn")} {board.turn}
				</Badge>
			</div>
			<p className="m-0 flex items-center gap-2" data-testid="board-current">
				<span className={`size-1.5 rounded-full ${waiting !== undefined ? "bg-[var(--warn)]" : board.current === undefined ? "bg-muted-foreground" : "bg-primary"}`} />
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
			{board.steps.length === 0 ? null : (
				<ol className="mt-3 space-y-2 border-t border-border/70 pt-3" data-testid="board-steps">
					{board.steps
						.slice()
						.reverse()
						.slice(0, 8)
						.map((step, index) => (
							<li key={`${step}-${index}`} className="flex gap-2 text-[12px] leading-5 text-muted-foreground">
								<span className="mt-[7px] size-1 shrink-0 rounded-full bg-[var(--edge)]" />
								<span className="min-w-0 break-words">{step}</span>
							</li>
						))}
				</ol>
			)}
		</section>
	);
}
