// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("the page has no #root to mount into");

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
