// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import logo from "./assets/logo.png";
import type { AgentEvent, HarnessStatus, MuApi, SessionSnapshot, Unsubscribe } from "../shared/api.ts";
import type { ConversationEvent } from "../shared/conversation.ts";
import { ConversationStore } from "./lib/conversation-store.ts";
import { hasOnboarded, markOnboarded, useLanguage } from "./lib/i18n.ts";
import { ConversationPage } from "./pages/Conversation/ConversationPage.tsx";
import { FirstRunPage } from "./pages/FirstRun/FirstRunPage.tsx";
import { SettingsPage } from "./pages/Settings/SettingsPage.tsx";
import { BoardPanel } from "./panels/Board/BoardPanel.tsx";
import { FilesPanel } from "./panels/Files/FilesPanel.tsx";
import { JudgmentsPanel } from "./panels/Judgments/JudgmentsPanel.tsx";

/**
 * The window: the conversation, three panels around it, the settings screen, and the two screens that come before the
 * agent is usable (the first run) or after it fails (the error screen).
 *
 * The event stream goes into `ConversationStore`, not into this component's state: a token per delta would re-render
 * everything. The panels read the store's snapshot (board, files) or their own source (judgments), and none of them
 * shares a context with the conversation.
 */

type View = "conversation" | "settings";

function statusLabel(status: HarnessStatus): string {
	switch (status.state) {
		case "stopped":
			return "stopped";
		case "starting":
			return "starting";
		case "running":
			return `running · ${status.layout}`;
		case "restarting":
			return `restarting ${status.attempt}/${status.of}`;
		case "failed":
			return "failed";
	}
}

function bridge(): MuApi | undefined {
	return (window as { mu?: MuApi }).mu;
}

export function App(): React.JSX.Element {
	const [api] = useState<MuApi | undefined>(bridge);
	const { language, setLanguage, text } = useLanguage();
	const [onboarded, setOnboarded] = useState<boolean>(hasOnboarded);
	const [view, setView] = useState<View>("conversation");
	const [store] = useState(() => new ConversationStore());
	const [version, setVersion] = useState<string>("");
	const [status, setStatus] = useState<HarnessStatus>({ state: "stopped" });
	const [snapshot, setSnapshot] = useState<SessionSnapshot | undefined>(undefined);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const operation = useRef(false);
	const [sessionRevision, setSessionRevision] = useState(0);

	const report = useCallback((message: string) => setError(message), []);

	useEffect(() => {
		if (api === undefined) return;
		let alive = true;
		const cleanups: Unsubscribe[] = [];
		cleanups.push(
			api.harness.onStatus((next) => {
				if (alive) setStatus(next);
			}),
		);
		cleanups.push(
			api.harness.onEvent((event: AgentEvent) => {
				// The protocol puts UI requests in the same stream; the reducer knows which ones are questions.
				store.push(event as ConversationEvent);
			}),
		);
		void api.app
			.version()
			.then((value) => {
				if (alive) setVersion(value);
			})
			.catch(() => {});
		void api.harness
			.status()
			.then((value) => {
				if (alive) setStatus(value);
			})
			.catch(() => {});
		return () => {
			alive = false;
			for (const cleanup of cleanups) cleanup();
		};
	}, [api, store]);

	// The session only exists while the agent runs, so the snapshot is refreshed when it becomes available.
	useEffect(() => {
		if (api === undefined || status.state !== "running") {
			setSnapshot(undefined);
			return;
		}
		let alive = true;
		void api.harness
			.snapshot()
			.then((value) => {
				if (alive) setSnapshot(value);
			})
			.catch(() => {
				if (alive) setSnapshot(undefined);
			});
		return () => {
			alive = false;
		};
	}, [api, status.state, sessionRevision]);

	const restart = useCallback(async () => {
		if (api === undefined || operation.current) return;
		operation.current = true;
		setBusy(true);
		setError("");
		try {
			store.reset();
			setStatus(await api.harness.restart());
		} catch (failure) {
			report(failure instanceof Error ? failure.message : String(failure));
		} finally {
			operation.current = false;
			setBusy(false);
		}
	}, [api, store, report]);

	const newConversation = useCallback(async () => {
		if (api === undefined || operation.current) return;
		operation.current = true;
		setBusy(true);
		setError("");
		try {
			await api.harness.newSession();
			store.reset();
			setSessionRevision((revision) => revision + 1);
		} catch (failure) {
			report(failure instanceof Error ? failure.message : String(failure));
		} finally {
			operation.current = false;
			setBusy(false);
		}
	}, [api, store, report]);

	if (api === undefined) {
		return (
			<main className="screen">
				<h1>mu</h1>
				<p className="muted">This page was not loaded by the mu app, so it has no way to reach the agent.</p>
			</main>
		);
	}

	if (!onboarded) {
		return (
			<FirstRunPage
				api={api}
				language={language}
				setLanguage={setLanguage}
				text={text}
				onDone={() => {
					markOnboarded();
					setOnboarded(true);
				}}
			/>
		);
	}

	const running = status.state === "running";

	return (
		<div className="app">
			<header className="bar">
				<span className="brand">
					<img src={logo} alt="spec.ai.jev" />
				</span>
				<span className={`chip chip-${status.state}`}>{statusLabel(status)}</span>
				{version === "" ? null : <span className="muted">v{version}</span>}
				{snapshot?.model === undefined ? null : <span className="muted">{snapshot.model}</span>}
				<span className="grow" />
				<nav className="nav">
					<button
						type="button"
						className={view === "conversation" ? "active" : ""}
						aria-current={view === "conversation" ? "page" : undefined}
						onClick={() => setView("conversation")}
						data-testid="nav-conversation"
					>
						{text("nav.conversation")}
					</button>
					<button
						type="button"
						className={view === "settings" ? "active" : ""}
						aria-current={view === "settings" ? "page" : undefined}
						onClick={() => setView("settings")}
						data-testid="nav-settings"
					>
						{text("nav.settings")}
					</button>
				</nav>
				<button type="button" onClick={() => void restart()} disabled={busy} data-testid="restart">
					{status.state === "failed" ? text("app.retry") : text("app.restart")}
				</button>
				<button
					type="button"
					onClick={() => void newConversation()}
					disabled={!running || busy}
					data-testid="new-conversation"
				>
					{text("conversation.new")}
				</button>
			</header>

			{error === "" ? null : (
				<div className="error-banner" role="alert">
					<p className="line-error" data-testid="error">
						{error}
					</p>
					<button type="button" aria-label={text("app.dismiss")} onClick={() => setError("")}>
						×
					</button>
				</div>
			)}

			{status.state === "failed" ? (
				<Failure status={status} onRetry={() => void restart()} retryLabel={text("app.retry")} />
			) : (
				<>
					{view === "settings" ? (
						<SettingsPage api={api} language={language} setLanguage={setLanguage} text={text} />
					) : null}
					<div className="workspace" hidden={view !== "conversation"}>
						<ConversationPage
							key={sessionRevision}
							api={api}
							store={store}
							running={running && !busy}
							active={view === "conversation"}
							onError={report}
							language={language}
						/>
						<aside className="panels">
							{view === "conversation" ? <Panels store={store} api={api} text={text} /> : null}
						</aside>
					</div>
				</>
			)}
		</div>
	);
}

/** The three panels, each with its own source: the store for two, `mu ledger` for the third. */
function Panels({
	store,
	api,
	text,
}: {
	readonly store: ConversationStore;
	readonly api: MuApi;
	readonly text: (key: string) => string;
}): React.JSX.Element {
	const [tab, setTab] = useState<"board" | "files" | "judgments">("board");
	const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
	return (
		<>
			<nav className="tabs">
				{(["board", "files", "judgments"] as const).map((name) => (
					<button
						key={name}
						type="button"
						className={tab === name ? "active" : ""}
						aria-pressed={tab === name}
						onClick={() => setTab(name)}
						data-testid={`tab-${name}`}
					>
						{text(`panel.${name}`)}
					</button>
				))}
			</nav>
			{tab === "board" ? <BoardPanel board={state.board} text={text} /> : null}
			{tab === "files" ? <FilesPanel files={state.files} text={text} /> : null}
			{tab === "judgments" ? <JudgmentsPanel api={api} text={text} /> : null}
		</>
	);
}

/** The screen a user gets when the app cannot find mu: what happened, where it looked, and what to do about it. */
function Failure({
	status,
	onRetry,
	retryLabel,
}: {
	readonly status: Extract<HarnessStatus, { state: "failed" }>;
	readonly onRetry: () => void;
	readonly retryLabel: string;
}): React.JSX.Element {
	const hint =
		status.expected.layout === "package"
			? `This build expects mu inside its own resources folder at ${status.expected.root}. Reinstalling the app restores it.`
			: `Set MU_ROOT to a mu checkout (or install mu-agent with npm), then press Retry. This build looked for ${status.expected.root}.`;
	return (
		<main className="screen failure">
			<h1>The agent could not start</h1>
			<p>{status.reason}</p>
			<p className="muted">{hint}</p>
			{status.stderr.length === 0 ? null : (
				<>
					<h2>Last lines from the agent</h2>
					<pre>{status.stderr.join("\n")}</pre>
				</>
			)}
			<button type="button" onClick={onRetry}>
				{retryLabel}
			</button>
		</main>
	);
}
