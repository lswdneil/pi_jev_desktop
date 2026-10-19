// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * A loopback server Chromium will actually talk to.
 *
 * `server.listen(0)` picks any free port, and Chromium refuses a set of them as unsafe (`ERR_UNSAFE_PORT`) whatever the
 * page asks: 1719 is on that list, and one run of the preview test happened to land on it and failed with a message that
 * looks like a bug in the app. So the loopback port is chosen, checked, and re-picked; the HTML the server answers with
 * is the caller's.
 */

import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

/**
 * Ports above 1024 that Chromium treats as unsafe. The list is from `net/base/port_util.cc`; only the ones a random bind
 * can realistically land on matter here, and a stale entry costs one retry, nothing else.
 */
const UNSAFE_PORTS = new Set([1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);

/** Start an http server on a loopback port Chromium accepts, answering with `body` for every request. */
export async function listenLoopback(body: string | ((url: string) => { readonly contentType: string; readonly body: string })): Promise<{ server: Server; origin: string }> {
	for (let attempt = 0; attempt < 20; attempt++) {
		const server = createServer((request, response) => {
			const answer = typeof body === "string" ? { contentType: "text/html; charset=utf-8", body } : body(request.url ?? "/");
			response.writeHead(200, { "content-type": answer.contentType });
			response.end(answer.body);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const { port } = server.address() as AddressInfo;
		if (!UNSAFE_PORTS.has(port)) return { server, origin: `http://127.0.0.1:${port}` };
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
	throw new Error("could not bind a loopback port Chromium accepts");
}
