// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { FolderOpen, MessageSquare, PanelRightClose, PanelRightOpen, Plus, RotateCw, Search, Settings, X } from "lucide-react";
import { toast } from "sonner";
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import logo from "./assets/logo.png";
import type { AgentEvent, HarnessStatus, ModelChoice, SpecApi, SessionSnapshot, SessionSummary, Unsubscribe } from "../shared/api.ts";
import type { ConversationEvent } from "../shared/conversation.ts";
import { ConversationStore } from "./lib/conversation-store.ts";
import { hasOnboarded, markOnboarded, useLanguage } from "./lib/i18n.ts";
import { QuickOpen, type PaletteItem } from "./lib/QuickOpen.tsx";
import { readRecentPalette, rememberPaletteUse } from "./lib/palette-recent.ts";
import {
	readPanelTab,
	readPanelsOpen,
	rememberPanelTab,
	rememberPanelsOpen,
	type PanelTab,
} from "./lib/panel-visibility.ts";
import { forgetWorkspace, readRecentWorkspaces, rememberWorkspace } from "./lib/recent-workspaces.ts";
import { cn } from "./lib/utils.ts";
import { ConversationPage } from "./pages/Conversation/ConversationPage.tsx";
import { FirstRunPage } from "./pages/FirstRun/FirstRunPage.tsx";
import { SettingsPage } from "./pages/Settings/SettingsPage.tsx";
import { BoardPanel } from "./panels/Board/BoardPanel.tsx";
import { FilesPanel } from "./panels/Files/FilesPanel.tsx";
import { JudgmentsPanel } from "./panels/Judgments/JudgmentsPanel.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip.tsx";
import { Toaster } from "./ui/sonner.tsx";

/**
 * The window: the conversation, three panels around it, the settings screen, and the two screens that come before the
 * agent is usable (the first run) or after it fails (the error screen).
 *
 * The event stream goes into `ConversationStore`, not into this component's state: a token per delta would re-render
 * everything. The panels read the store's snapshot (board, files) or their own source (judgments), and none of them
 * shares a context with the conversation.
 */

type View = "conversation" | "settings";

/** Stable ids: the saved layout is keyed by them, and a fresh array every render would re-read storage. */
const WORKSPACE_PANEL_IDS = ["chat", "panels"];

/** The modifier every shortcut below uses: Command on macOS, Control everywhere else. */
const ACCELERATOR = /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl+";

/** The chip in the rail's footer. `layout` stays as it is: it names where spec.ai.jev came from, which is the diagnostic. */
function statusLabel(status: HarnessStatus, text: (key: string) => string): string {
	switch (status.state) {
		case "stopped":
			return text("status.stopped");
		case "starting":
			return text("status.starting");
		case "running":
			return `${text("status.running")} · ${status.layout}`;
		case "restarting":
			return `${text("status.restarting")} ${status.attempt}/${status.of}`;
		case "failed":
			return text("status.failed");
	}
}

function bridge(): SpecApi | undefined {
	return (window as { spec?: SpecApi }).spec;
}

/** The last segment of a folder path: what a rail item is called. */
function projectName(path: string): string {
	return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

export function App(): React.JSX.Element {
	const [api] = useState<SpecApi | undefined>(bridge);
	const { language, setLanguage, text } = useLanguage();
	const [onboarded, setOnboarded] = useState<boolean>(hasOnboarded);
	const [view, setView] = useState<View>("conversation");
	const [store] = useState(() => new ConversationStore());
	const [version, setVersion] = useState<string>("");
	const [status, setStatus] = useState<HarnessStatus>({ state: "stopped" });
	const [snapshot, setSnapshot] = useState<SessionSnapshot | undefined>(undefined);
	const [busy, setBusy] = useState(false);
	const operation = useRef(false);
	const [sessionRevision, setSessionRevision] = useState(0);
	const [workspacePath, setWorkspacePath] = useState("");
	const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>(readRecentWorkspaces);
	const [models, setModels] = useState<readonly ModelChoice[]>([]);
	const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
	const [allSessions, setAllSessions] = useState<readonly SessionSummary[]>([]);
	const [sessionQuery, setSessionQuery] = useState("");
	const [renaming, setRenaming] = useState(false);
	const [sessionName, setSessionName] = useState("");
	const [confirmDelete, setConfirmDelete] = useState<string | undefined>(undefined);
	const [panelTab, setPanelTab] = useState<PanelTab>(readPanelTab);
	const [quickOpen, setQuickOpen] = useState(false);
	const [panelsOpen, setPanelsOpen] = useState(readPanelsOpen);
	const [recentPalette, setRecentPalette] = useState<string[]>(readRecentPalette);
	const [openFile, setOpenFile] = useState<{ readonly path: string; readonly nonce: number } | undefined>(undefined);
	const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
	const zoom = useRef(0);
	const panelsRef = usePanelRef();
	// Drag a width once and the split comes back at that width. Folding is a separate, boolean choice.
	const workspaceLayout = useDefaultLayout({
		id: "spec.ai.jev.workspace",
		panelIds: WORKSPACE_PANEL_IDS,
		onlySaveAfterUserInteractions: true,
	});
	const [modelBusy, setModelBusy] = useState(false);

	const report = useCallback((message: string) => {
		toast.error(<span data-testid="error">{message}</span>, { id: "app-error", duration: Infinity, closeButton: true });
	}, []);

	/** Links are preview requests: the hardened view in the right third, never a navigation of this page. */
	const openPreview = useCallback(
		(url: string) => {
			if (api === undefined) return;
			void api.preview
				.open(url)
				.then(() => setPreviewUrl(url))
				.catch((failure: unknown) => report(failure instanceof Error ? failure.message : String(failure)));
		},
		[api, report],
	);

	const closePreview = useCallback(() => {
		if (api === undefined) return;
		void api.preview
			.close()
			.catch(() => {})
			.finally(() => setPreviewUrl(undefined));
	}, [api]);

	const setPanels = useCallback((open: boolean) => {
		if (open) panelsRef.current?.expand();
		else panelsRef.current?.collapse();
		setPanelsOpen(open);
		rememberPanelsOpen(open);
	}, []);

	/** The panel's own state is the truth once it is mounted; before that, the remembered choice is. */
	const togglePanels = useCallback(() => {
		const open = panelsRef.current === null ? panelsOpen : !panelsRef.current.isCollapsed();
		setPanels(!open);
	}, [panelsOpen, setPanels]);

	const choosePanelTab = useCallback((tab: PanelTab) => {
		setPanelTab(tab);
		rememberPanelTab(tab);
	}, []);

	const touchPalette = useCallback((id: string) => setRecentPalette(rememberPaletteUse(id)), []);

	// Settings and the first run are full-window screens; a native view over them would be a panel nobody can close.
	useEffect(() => {
		if (view !== "conversation" && previewUrl !== undefined) closePreview();
	}, [view, previewUrl, closePreview]);

	useEffect(() => {
		if (api === undefined) return;
		let alive = true;
		void api.app
			.zoom()
			.then((level) => {
				if (alive) zoom.current = level;
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [api]);

	// The group is only mounted once the first run is done; fold a remembered-closed panel before it paints.
	useLayoutEffect(() => {
		if (!panelsOpen) panelsRef.current?.collapse();
		// `onboarded` is the moment the layout mounts; `panelsOpen` is read from that same render.
	}, [onboarded]);

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

	useEffect(() => {
		if (api === undefined) return;
		let alive = true;
		void api.workspace
			.current()
			.then((value) => {
				if (alive) setWorkspacePath(value.path);
			})
			.catch(() => {
				if (alive) setWorkspacePath("");
			});
		return () => {
			alive = false;
		};
	}, [api]);

	useEffect(() => {
		if (api === undefined || status.state !== "running") return;
		let alive = true;
		void api.harness
			.models()
			.then((value) => {
				if (alive) setModels(value);
			})
			.catch(() => {
				if (alive) setModels([]);
			});
		return () => {
			alive = false;
		};
	}, [api, status.state]);

	useEffect(() => {
		if (api === undefined || status.state !== "running") {
			setSessions([]);
			return;
		}
		let alive = true;
		void api.sessions
			.list()
			.then((value) => {
				if (alive) setSessions(value);
			})
			.catch(() => {
				if (alive) setSessions([]);
			});
		return () => {
			alive = false;
		};
	}, [api, status.state, workspacePath, sessionRevision]);

	// Sessions from other projects: the rail's way back into yesterday's work without opening the folder first.
	useEffect(() => {
		if (api === undefined || status.state !== "running") {
			setAllSessions([]);
			return;
		}
		let alive = true;
		void api.sessions
			.listAll()
			.then((value) => {
				if (alive) setAllSessions(value);
			})
			.catch(() => {
				if (alive) setAllSessions([]);
			});
		return () => {
			alive = false;
		};
	}, [api, status.state, workspacePath, sessionRevision]);

	const restart = useCallback(async () => {
		if (api === undefined || operation.current) return;
		operation.current = true;
		setBusy(true);
		toast.dismiss("app-error");
		try {
			const next = await api.harness.restart();
			store.reset();
			setStatus(next);
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
		toast.dismiss("app-error");
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

	const chooseWorkspace = useCallback(async () => {
		if (api === undefined || operation.current) return;
		operation.current = true;
		setBusy(true);
		toast.dismiss("app-error");
		try {
			const choice = await api.workspace.choose();
			if (choice.cancelled) return;
			setWorkspacePath(choice.path);
			setRecentWorkspaces(rememberWorkspace(choice.path));
			store.reset();
			setSessionRevision((revision) => revision + 1);
			setStatus(choice.status);
		} catch (failure) {
			report(failure instanceof Error ? failure.message : String(failure));
		} finally {
			operation.current = false;
			setBusy(false);
		}
	}, [api, store, report]);

	const openWorkspace = useCallback(
		async (path: string) => {
			if (api === undefined || operation.current) return;
			operation.current = true;
			setBusy(true);
			toast.dismiss("app-error");
			try {
				const choice = await api.workspace.open(path);
				if (choice.cancelled) return;
				setWorkspacePath(choice.path);
				setRecentWorkspaces(rememberWorkspace(choice.path));
				store.reset();
				setSessionRevision((revision) => revision + 1);
				setStatus(choice.status);
			} catch (failure) {
				report(failure instanceof Error ? failure.message : String(failure));
			} finally {
				operation.current = false;
				setBusy(false);
			}
		},
		[api, store, report],
	);

	const chooseModel = useCallback(
		async (value: string) => {
			if (api === undefined || value === "") return;
			const [provider, ...rest] = value.split("/");
			const modelId = rest.join("/");
			if (provider === undefined || modelId === "") return;
			setModelBusy(true);
			toast.dismiss("app-error");
			try {
				await api.harness.setModel(provider, modelId);
				setSnapshot(await api.harness.snapshot());
			} catch (failure) {
				report(failure instanceof Error ? failure.message : String(failure));
			} finally {
				setModelBusy(false);
			}
		},
		[api, report],
	);

	const openSession = useCallback(
		async (path: string) => {
			if (api === undefined || operation.current) return;
			operation.current = true;
			setBusy(true);
			toast.dismiss("app-error");
			try {
				await api.sessions.open(path);
				store.reset();
				setSessionRevision((revision) => revision + 1);
				setSnapshot(await api.harness.snapshot());
				setStatus(await api.harness.status());
			} catch (failure) {
				report(failure instanceof Error ? failure.message : String(failure));
			} finally {
				operation.current = false;
				setBusy(false);
			}
		},
		[api, store, report],
	);

	/** A session from another project: the main process moves the agent there and switches in one step. */
	const openSessionAcross = useCallback(
		async (path: string) => {
			if (api === undefined || operation.current) return;
			operation.current = true;
			setBusy(true);
			toast.dismiss("app-error");
			try {
				const opened = await api.sessions.openAcross(path);
				setWorkspacePath(opened.path);
				setRecentWorkspaces(rememberWorkspace(opened.path));
				store.reset();
				setSessionRevision((revision) => revision + 1);
				setSnapshot(await api.harness.snapshot());
				setStatus(await api.harness.status());
			} catch (failure) {
				report(failure instanceof Error ? failure.message : String(failure));
			} finally {
				operation.current = false;
				setBusy(false);
			}
		},
		[api, store, report],
	);

	// The shell's own keys: palette, panels, new task, project, settings, and the window's zoom.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (!(event.ctrlKey || event.metaKey)) return;
			const key = event.key.toLowerCase();
			if (key === "p" || key === "k") {
				event.preventDefault();
				setQuickOpen((open) => !open);
				return;
			}
			if (key === "b") {
				event.preventDefault();
				setQuickOpen(false);
				togglePanels();
				return;
			}
			if (key === "n") {
				event.preventDefault();
				setQuickOpen(false);
				void newConversation();
				return;
			}
			if (key === "o") {
				event.preventDefault();
				setQuickOpen(false);
				void chooseWorkspace();
				return;
			}
			if (event.key === ",") {
				event.preventDefault();
				setQuickOpen(false);
				setView("settings");
				return;
			}
			if (event.key === "=" || event.key === "+" || event.key === "-" || event.key === "0") {
				if (api === undefined) return;
				event.preventDefault();
				const next = event.key === "0" ? 0 : event.key === "-" ? zoom.current - 0.5 : zoom.current + 0.5;
				void api.app
					.setZoom(next)
					.then((level) => {
						zoom.current = level;
					})
					.catch(() => {});
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [api, togglePanels, newConversation, chooseWorkspace]);

	const renameSession = useCallback(
		async (name: string) => {
			if (api === undefined || operation.current) return;
			operation.current = true;
			setBusy(true);
			toast.dismiss("app-error");
			try {
				await api.sessions.rename(name);
				setSnapshot(await api.harness.snapshot());
				setSessionRevision((revision) => revision + 1);
				setRenaming(false);
				setSessionName("");
			} catch (failure) {
				report(failure instanceof Error ? failure.message : String(failure));
			} finally {
				operation.current = false;
				setBusy(false);
			}
		},
		[api, report],
	);

	/**
	 * Deleting is a two-step click in the rail, and the two steps happen here: the row asks, then this runs.
	 *
	 * The main process leaves the session before removing the file when the agent has it open, so what comes back is
	 * either a deletion or a sentence about why not.
	 */
	const removeSession = useCallback(
		async (path: string) => {
			if (api === undefined || operation.current) return;
			operation.current = true;
			setBusy(true);
			toast.dismiss("app-error");
			try {
				const result = await api.sessions.remove(path);
				setConfirmDelete(undefined);
				if (!result.deleted) {
					report(text("app.sessionGone"));
					return;
				}
				setSessionRevision((revision) => revision + 1);
				if (path === snapshot?.sessionFile) {
					store.reset();
					setSnapshot(await api.harness.snapshot());
				}
			} catch (failure) {
				report(failure instanceof Error ? failure.message : String(failure));
			} finally {
				operation.current = false;
				setBusy(false);
			}
		},
		[api, store, report, snapshot?.sessionFile, text],
	);

	if (api === undefined) {
		return (
			<main className="screen">
				<h1>spec.ai.jev</h1>
				<p className="muted">This page was not loaded by spec.ai.jev, so it has no way to reach the agent.</p>
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
	const workspaceName = workspacePath === "" ? "" : projectName(workspacePath);
	const sessionFilter = sessionQuery.trim().toLowerCase();
	const here = workspacePath.replace(/[\\/]+$/, "").toLowerCase();
	const listedSessions = sessions.filter(
		(session) =>
			session.path !== snapshot?.sessionFile &&
			(sessionFilter === "" ||
				`${session.title} ${session.id} ${session.cwd}`.toLowerCase().includes(sessionFilter)),
	);
	const otherSessions = allSessions
		.filter((session) => session.cwd !== "" && session.cwd.replace(/[\\/]+$/, "").toLowerCase() !== here)
		.filter((session) => session.path !== snapshot?.sessionFile)
		.filter(
			(session) =>
				sessionFilter === "" ||
				`${session.title} ${session.id} ${session.cwd}`.toLowerCase().includes(sessionFilter),
		)
		.slice(0, 20);

	/** The separator can fold the panel too; keep the header and the palette in step with what it did. */
	const syncPanels = (): void => {
		const open = panelsRef.current?.isCollapsed() !== true;
		if (open === panelsOpen) return;
		setPanelsOpen(open);
		rememberPanelsOpen(open);
	};

	const paletteRank = (id: string): number => {
		const at = recentPalette.indexOf(id);
		return at === -1 ? Number.MAX_SAFE_INTEGER : at;
	};

	const paletteItems: PaletteItem[] = (
		[
			{
				id: "action:new-task",
				label: text("app.newTask"),
				shortcut: `${ACCELERATOR}N`,
				icon: <Plus />,
				group: "action",
				run: () => void newConversation(),
			},
			{
				id: "action:workspace",
				label: text("app.chooseWorkspace"),
				shortcut: `${ACCELERATOR}O`,
				icon: <FolderOpen />,
				group: "action",
				run: () => void chooseWorkspace(),
			},
			{
				id: "action:settings",
				label: text("nav.settings"),
				shortcut: `${ACCELERATOR},`,
				icon: <Settings />,
				group: "action",
				run: () => setView("settings"),
			},
			{
				id: "action:restart",
				label: status.state === "failed" ? text("app.retry") : text("app.restart"),
				icon: <RotateCw />,
				group: "action",
				run: () => void restart(),
			},
			{
				id: "action:panels",
				label: panelsOpen ? text("app.hidePanels") : text("app.showPanels"),
				icon: panelsOpen ? <PanelRightClose /> : <PanelRightOpen />,
				shortcut: `${ACCELERATOR}B`,
				group: "action",
				run: togglePanels,
			},
			...allSessions
				.filter((session) => session.path !== snapshot?.sessionFile)
				.slice(0, 40)
				.map((session) => ({
					id: `session:${session.path}`,
					label: session.title,
					hint: `${projectName(session.cwd)} · ${session.updatedAt.slice(0, 10)}`,
					group: "session" as const,
					run: () => {
						if (session.cwd.replace(/[\\/]+$/, "").toLowerCase() === here) void openSession(session.path);
						else void openSessionAcross(session.path);
					},
				})),
		] satisfies PaletteItem[]
	)
		// Recent items rise inside their own group; the group order itself stays fixed.
		.sort((left, right) => paletteRank(left.id) - paletteRank(right.id))
		.map((item) => ({
			...item,
			run: () => {
				touchPalette(item.id);
				item.run();
			},
		}));

	return (
		<TooltipProvider delayDuration={350}>
			<div className="shell">
			<aside className="rail">
				<div className="rail-brand brand">
					<img src={logo} alt="spec.ai.jev" />
					<div>
						<strong>spec.ai.jev</strong>
						<span>{text("app.agentWorkspace")}</span>
					</div>
				</div>

				<Button
					type="button"
					size="lg"
					className="w-full"
					onClick={() => void newConversation()}
					disabled={!running || busy}
					data-testid="new-conversation"
				>
					<Plus />
					{text("app.newTask")}
				</Button>

				<section className="rail-section">
					<h2>{text("app.workspace")}</h2>
					<Button
						type="button"
						variant="secondary"
						className="h-auto w-full flex-col items-start gap-1 px-3 py-2.5 text-left"
						onClick={() => void chooseWorkspace()}
						disabled={busy}
						title={workspacePath === "" ? text("app.chooseWorkspace") : workspacePath}
					>
						<span className="workspace-name flex items-center gap-2 font-semibold">
							<FolderOpen className="text-primary" />
							{workspaceName === "" ? text("app.chooseWorkspace") : workspaceName}
						</span>
						<span className="muted">{text("app.openProject")}</span>
					</Button>
				</section>

				{recentWorkspaces.length === 0 ? null : (
					<section className="rail-section">
						<h2>{text("app.recent")}</h2>
						<div className="recent-list">
							{recentWorkspaces.map((path) => {
								const name = projectName(path);
								return (
									<div key={path} className={path === workspacePath ? "recent-row active" : "recent-row"}>
										<button
											type="button"
											className="recent-item"
											onClick={() => void openWorkspace(path)}
											disabled={busy || path === workspacePath}
											title={path}
										>
											<span className="recent-name">{name}</span>
											<span className="recent-path">{path}</span>
										</button>
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											data-testid="recent-forget"
											aria-label={`${text("app.forgetProject")}: ${name}`}
											title={text("app.forgetProject")}
											onClick={() => setRecentWorkspaces(forgetWorkspace(path))}
											disabled={busy}
										>
											<X />
										</Button>
									</div>
								);
							})}
						</div>
					</section>
				)}

				<section className="rail-section rail-session">
					<h2>{text("app.sessions")}</h2>
					<div className="relative">
						<Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							type="search"
							className="pl-8"
							value={sessionQuery}
							onChange={(event) => setSessionQuery(event.target.value)}
							placeholder={text("app.searchSessions")}
							aria-label={text("app.searchSessions")}
						/>
					</div>
					<div className="session-card">
						<span>
							{snapshot?.sessionName ??
								(snapshot?.sessionId === undefined
									? text("app.noSession")
									: `${text("app.session")} · ${snapshot.sessionId.slice(0, 12)}`)}
						</span>
						{snapshot?.model === undefined ? null : <small>{snapshot.model}</small>}
					</div>
					{renaming ? (
						<form
							className="session-rename"
							onSubmit={(event) => {
								event.preventDefault();
								void renameSession(sessionName);
							}}
						>
							<Input
								type="text"
								value={sessionName}
								onChange={(event) => setSessionName(event.target.value)}
								placeholder={text("app.rename")}
								aria-label={text("app.rename")}
								autoFocus
							/>
							<Button type="submit" size="sm" disabled={busy || sessionName.trim() === ""}>
								{text("app.save")}
							</Button>
							<Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(false)} disabled={busy}>
								{text("app.cancel")}
							</Button>
						</form>
					) : (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => {
								setSessionName(snapshot?.sessionName ?? "");
								setRenaming(true);
							}}
							disabled={!running || busy}
						>
							{text("app.rename")}
						</Button>
					)}
					{sessions.length === 0 ? <p className="muted session-empty">{text("app.noSessions")}</p> : null}
					{sessions.length > 0 && listedSessions.length === 0 ? (
						<p className="muted session-empty">{text("app.noSessionMatches")}</p>
					) : null}
					{listedSessions.length === 0 ? null : (
						<div className="session-list">
							{listedSessions.map((session) => (
									<div key={session.path} className="session-row">
										<button
											type="button"
											className="session-item"
											onClick={() => void openSession(session.path)}
											disabled={busy}
											title={session.path}
										>
											<span className="session-title">{session.title}</span>
											<span className="session-meta">{session.updatedAt.slice(0, 10)}</span>
										</button>
										{confirmDelete === session.path ? (
											<span className="session-confirm">
												<Button
													type="button"
													size="sm"
													variant="destructive"
													data-testid="session-delete-confirm"
													disabled={busy}
													onClick={() => void removeSession(session.path)}
												>
													{text("app.delete")}
												</Button>
												<Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDelete(undefined)}>
													{text("app.cancel")}
												</Button>
											</span>
										) : (
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												data-testid="session-delete"
												aria-label={`${text("app.deleteSession")}: ${session.title}`}
												title={text("app.deleteSession")}
												disabled={busy}
												onClick={() => setConfirmDelete(session.path)}
											>
												<X />
											</Button>
										)}
									</div>
								))}
						</div>
					)}
					{otherSessions.length === 0 ? null : (
						<div className="session-other">
							<h3>{text("app.otherProjects")}</h3>
							<div className="session-list">
								{otherSessions.map((session) => (
									<button
										key={session.path}
										type="button"
										className="session-item"
										data-testid="session-other"
										onClick={() => void openSessionAcross(session.path)}
										disabled={busy}
										title={session.path}
									>
										<span className="session-title">{session.title}</span>
										<span className="session-meta">
											{projectName(session.cwd)} · {session.updatedAt.slice(0, 10)}
										</span>
									</button>
								))}
							</div>
						</div>
					)}
				</section>

				<nav className="rail-nav">
					<Button
						type="button"
						variant={view === "conversation" ? "secondary" : "ghost"}
						className={cn("w-full justify-start", view === "conversation" && "bg-primary/10 text-primary hover:bg-primary/15")}
						aria-current={view === "conversation" ? "page" : undefined}
						onClick={() => setView("conversation")}
						data-testid="nav-conversation"
					>
						<MessageSquare />
						{text("nav.conversation")}
					</Button>
					<Button
						type="button"
						variant={view === "settings" ? "secondary" : "ghost"}
						className={cn("w-full justify-start", view === "settings" && "bg-primary/10 text-primary hover:bg-primary/15")}
						aria-current={view === "settings" ? "page" : undefined}
						onClick={() => setView("settings")}
						data-testid="nav-settings"
					>
						<Settings />
						{text("nav.settings")}
					</Button>
				</nav>

				<div className="rail-footer">
					<div className="rail-status">
						<span className={`chip chip-${status.state}`} role="status" aria-live="polite">
							{statusLabel(status, text)}
						</span>
						{version === "" ? null : <span className="muted">v{version}</span>}
					</div>
					<Button type="button" variant="outline" size="sm" className="w-full" onClick={() => void restart()} disabled={busy} data-testid="restart">
						<RotateCw />
						{status.state === "failed" ? text("app.retry") : text("app.restart")}
					</Button>
				</div>
			</aside>

			<main className="app">
				<header className="bar">
					<span className="bar-kicker">{text("app.workspace")}</span>
					<strong className="bar-title">{workspaceName === "" ? text("app.chooseWorkspace") : workspaceName}</strong>
					<span className="grow" />
					{previewUrl === undefined ? null : (
						<span className="preview-chip" data-testid="preview-status">
							<code>{hostOf(previewUrl)}</code>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button type="button" variant="ghost" size="icon-sm" data-testid="close-preview" onClick={closePreview} aria-label={text("preview.close")}>
										<X />
									</Button>
								</TooltipTrigger>
								<TooltipContent>{text("preview.close")}</TooltipContent>
							</Tooltip>
						</span>
					)}
					{models.length === 0 ? null : (
						<div className="flex items-center gap-2">
							<span className="muted">{text("app.model")}</span>
							<Select value={snapshot?.model ?? ""} onValueChange={(value) => void chooseModel(value)} disabled={!running || modelBusy}>
								<SelectTrigger className="w-[min(22rem,42vw)]" data-testid="model-picker" aria-label={text("app.model")}>
									<SelectValue placeholder={text("app.chooseModel")} />
								</SelectTrigger>
								<SelectContent>
									{models.map((model) => {
										const value = `${model.provider}/${model.id}`;
										return (
											<SelectItem key={value} value={value}>
												{value}
											</SelectItem>
										);
									})}
								</SelectContent>
							</Select>
						</div>
					)}
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={panelsOpen ? text("app.hidePanels") : text("app.showPanels")}
								onClick={() => setPanels(!panelsOpen)}
								data-testid="toggle-panels"
							>
								{panelsOpen ? <PanelRightClose /> : <PanelRightOpen />}
							</Button>
						</TooltipTrigger>
						<TooltipContent>{panelsOpen ? text("app.hidePanels") : text("app.showPanels")}</TooltipContent>
					</Tooltip>
				</header>

			{status.state === "failed" ? (
				<Failure status={status} onRetry={() => void restart()} retryLabel={text("app.retry")} />
			) : (
				<>
					{view === "settings" ? (
						<SettingsPage api={api} language={language} setLanguage={setLanguage} text={text} />
					) : null}
					<div className="flex min-h-0 flex-1" hidden={view !== "conversation"}>
						<Group
							orientation="horizontal"
							className="min-h-0 w-full"
							defaultLayout={workspaceLayout.defaultLayout}
							onLayoutChanged={workspaceLayout.onLayoutChanged}
							data-testid="workspace-split"
						>
							<Panel id="chat" defaultSize="68" minSize="45" className="flex min-h-0 min-w-0 flex-col">
								<ConversationPage
									key={sessionRevision}
									api={api}
									store={store}
									running={running && !busy}
									active={view === "conversation"}
									onError={report}
									onOpenLink={openPreview}
									language={language}
								/>
							</Panel>
							<Separator
								className="w-1.5 shrink-0 bg-transparent transition-colors hover:bg-primary/30 data-[resize-handle-state=drag]:bg-primary/50"
								data-testid="panel-separator"
							/>
							<Panel
								id="panels"
								defaultSize="32"
								minSize="22"
								maxSize="48"
								collapsible
								collapsedSize="0"
								panelRef={panelsRef}
								onResize={syncPanels}
								className="min-h-0 min-w-0 overflow-hidden"
								data-testid="right-panel"
							>
								<aside className="panels h-full overflow-x-hidden">
									{view === "conversation" ? (
										<Panels
											store={store}
											api={api}
											text={text}
											tab={panelTab}
											onTab={choosePanelTab}
											openFile={openFile}
										/>
									) : null}
								</aside>
							</Panel>
						</Group>
					</div>
				</>
			)}
			{quickOpen && api !== undefined ? (
				<QuickOpen
					api={api}
					text={text}
					items={paletteItems}
					onClose={() => setQuickOpen(false)}
					onOpen={(path) => {
						setOpenFile({ path, nonce: Date.now() });
						choosePanelTab("files");
						setQuickOpen(false);
					}}
				/>
			) : null}
				</main>
			</div>
			<Toaster />
		</TooltipProvider>
	);
}

/** The three panels, each with its own source: the store for two, `spec ledger` for the third. */
function Panels({
	store,
	api,
	text,
	tab,
	onTab,
	openFile,
}: {
	readonly store: ConversationStore;
	readonly api: SpecApi;
	readonly text: (key: string) => string;
	readonly tab: "board" | "files" | "judgments";
	readonly onTab: (tab: "board" | "files" | "judgments") => void;
	readonly openFile: { readonly path: string; readonly nonce: number } | undefined;
}): React.JSX.Element {
	const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
	return (
		<Tabs
			value={tab}
			onValueChange={(value) => onTab(value as "board" | "files" | "judgments")}
			className="flex min-h-0 flex-col gap-3"
		>
			<TabsList aria-label={text("panel.sections")} className="w-full justify-start">
				{(["board", "files", "judgments"] as const).map((name) => (
					<TabsTrigger key={name} value={name} id={`tab-${name}`} data-testid={`tab-${name}`}>
						{text(`panel.${name}`)}
					</TabsTrigger>
				))}
			</TabsList>
			<TabsContent value="board">
				<BoardPanel board={state.board} text={text} />
			</TabsContent>
			<TabsContent value="files">
				<FilesPanel files={state.files} api={api} text={text} openFile={openFile} />
			</TabsContent>
			<TabsContent value="judgments">
				<JudgmentsPanel api={api} text={text} />
			</TabsContent>
		</Tabs>
	);
}

/** The screen a user gets when the app cannot find spec.ai.jev: what happened, where it looked, and what to do about it. */
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
			? `This build expects the agent runtime inside its own resources folder at ${status.expected.root}. Reinstalling the app restores it.`
			: `Set SPEC_AI_JEV_ROOT to a runtime checkout (or install the agent runtime with npm), then press Retry. This build looked for ${status.expected.root}.`;
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
			<Button type="button" className="w-fit" onClick={onRetry}>
				<RotateCw />
				{retryLabel}
			</Button>
		</main>
	);
}
