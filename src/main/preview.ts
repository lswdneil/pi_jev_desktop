// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The preview: a page the agent opened, shown beside the conversation in its own session.
 *
 * It is a `WebContentsView` in a separate session, not a second window and not a `webview` tag: a view shares no
 * process with the app's own page, and its session starts with nothing allowed. The old shell did the opposite — the
 * preview ran in the default session, where permissions are granted by default (`desktop/.../index.ts:653-655`), and
 * subtracted from there. The rules live in `security.ts` where they are tested; this file only applies them.
 */

import { type BrowserWindow, type Session, WebContentsView, session } from "electron";

/** The height of the app's own header (`.bar`): the preview begins below it, never over it. */
const PREVIEW_TOP = 64;
import { PREVIEW_PARTITION, previewDownload, previewNavigation, previewPermission } from "./security.ts";

/** Nothing this session asks for is granted, no download starts, and it may only follow http(s). */
export function hardenPreviewSession(target: Session): void {
	target.setPermissionRequestHandler((_contents, permission, callback) => {
		callback(previewPermission(permission).allow);
	});
	target.setPermissionCheckHandler((_contents, permission) => previewPermission(permission).allow);
	target.on("will-download", (event, item) => {
		if (previewDownload().allow) return;
		item.cancel();
		event.preventDefault();
	});
}

/** The preview's own session, with an in-memory cache: what the agent looked at does not persist on disk. */
export function previewSession(): Session {
	const target = session.fromPartition(PREVIEW_PARTITION, { cache: true });
	hardenPreviewSession(target);
	return target;
}

/**
 * The WebContents ids that belong to a preview, so the app-wide navigation guard (see `index.ts`) can leave them their
 * own rule instead of applying the app page's. A Set of ids rather than objects: `webContents` are not comparable across
 * the guard's lifetime, and an id is what the event gives back.
 */
const previewIds = new Set<number>();

/** Whether a WebContents is a preview: it may follow http(s) links, and refuses everything else itself. */
export function isPreviewContents(id: number): boolean {
	return previewIds.has(id);
}

export class PreviewPanel {
	private readonly window: BrowserWindow;
	private view: WebContentsView | undefined;

	constructor(window: BrowserWindow) {
		this.window = window;
		// The view is positioned in the window's content coordinates, which change with the window.
		window.on("resize", () => this.layout());
	}

	/** Show a URL. Reusing one view keeps its history and its cookies in the preview partition. */
	async open(url: string): Promise<void> {
		const decision = previewNavigation(url);
		if (!decision.allow) throw new Error(decision.reason ?? `cannot preview ${url}`);

		const view = this.view ?? this.create(url);
		this.attach(view);
		await view.webContents.loadURL(url);
	}

	close(): void {
		const view = this.view;
		if (view === undefined) return;
		previewIds.delete(view.webContents.id);
		this.view = undefined;
		this.window.contentView.removeChildView(view);
		view.webContents.close();
	}

	private create(url: string): WebContentsView {
		void url;
		// `previewSession()` is what applies the rules: Electron creates a session on demand for a bare `partition`
		// string, and a session that was merely created has no handlers — so it granted every permission and allowed
		// downloads until an end-to-end test asked the page what it had been given. The session is passed in rather than
		// named, so the view cannot end up on an unhardened instance by a string mismatch either.
		const target = previewSession();
		const view = new WebContentsView({
			webPreferences: {
				session: target,
				contextIsolation: true,
				sandbox: true,
				nodeIntegration: false,
				webviewTag: false,
				webSecurity: true,
			},
		});
		view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
		view.webContents.on("will-navigate", (event, target) => {
			const decision = previewNavigation(target);
			if (!decision.allow) event.preventDefault();
		});
		previewIds.add(view.webContents.id);
		this.view = view;
		return view;
	}

	private attach(view: WebContentsView): void {
		this.layout();
		if (!this.window.contentView.children.includes(view)) this.window.contentView.addChildView(view);
	}

	/**
	 * The conversation keeps the left two thirds; the preview takes the right third, starting under the app's header so
	 * the window's own controls (including the one that closes this view) stay where a person can reach them.
	 */
	private layout(): void {
		const view = this.view;
		if (view === undefined) return;
		const { width, height } = this.window.getContentBounds();
		const split = Math.round(Math.min(Math.max(width * 0.34, 320), 720));
		view.setBounds({ x: width - split, y: PREVIEW_TOP, width: split, height: Math.max(0, height - PREVIEW_TOP) });
	}
}
