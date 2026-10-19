// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

const { app, BrowserWindow } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const outputDir = join(root, "test-results");

app.whenReady().then(async () => {
	const window = new BrowserWindow({
		show: false,
		width: 1440,
		height: 900,
		backgroundColor: "#0d0f12",
		webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
	});
	await window.loadFile(join(root, "docs", "prototypes", "index.html"));
	mkdirSync(outputDir, { recursive: true });
	const capture = async (name) => {
		await new Promise((resolve) => setTimeout(resolve, 180));
		const image = await window.webContents.capturePage();
		writeFileSync(join(outputDir, name), image.toPNG());
	};
	await capture("prototype-workspace.png");
	await window.webContents.executeJavaScript('document.querySelector(\'.switcher [data-target="running"]\').click()');
	await capture("prototype-running.png");
	await window.webContents.executeJavaScript('document.querySelector(\'.switcher [data-target="judgment"]\').click()');
	await capture("prototype-judgment.png");
	app.quit();
});
