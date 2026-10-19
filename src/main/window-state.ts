// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

/**
 * Where the window was last time, if that place still exists.
 *
 * Remembering the size is the small half; the half that matters is forgetting a position that is now on a monitor
 * somebody unplugged. A window restored entirely outside every display is an app that starts and cannot be seen, so a
 * rectangle has to keep a reachable piece of its title bar inside a work area, or the window is placed by the platform
 * instead.
 */

export interface WindowBounds {
	readonly x?: number;
	readonly y?: number;
	readonly width: number;
	readonly height: number;
}

export interface DisplayArea {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** At least this much of the window must be inside a display for its position to be worth keeping. */
const MIN_VISIBLE = 48;
export const MIN_WIDTH = 720;
export const MIN_HEIGHT = 480;
export const DEFAULT_WIDTH = 1180;
export const DEFAULT_HEIGHT = 780;

function finite(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function overlaps(bounds: WindowBounds, area: DisplayArea): boolean {
	const x = bounds.x ?? 0;
	const y = bounds.y ?? 0;
	const left = Math.max(x, area.x);
	const right = Math.min(x + bounds.width, area.x + area.width);
	const top = Math.max(y, area.y);
	const bottom = Math.min(y + bounds.height, area.y + area.height);
	return right - left >= MIN_VISIBLE && bottom - top >= MIN_VISIBLE;
}

/**
 * The bounds to open with. A saved rectangle is used only when it is a real one and touches a display; otherwise the
 * default size is returned without a position, which lets the platform centre it.
 */
export function restoreBounds(
	saved: unknown,
	displays: readonly DisplayArea[],
	fallback: { readonly width: number; readonly height: number } = { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
): WindowBounds {
	const size = {
		width: Math.max(MIN_WIDTH, fallback.width),
		height: Math.max(MIN_HEIGHT, fallback.height),
	};
	if (typeof saved !== "object" || saved === null) return size;
	const record = saved as Record<string, unknown>;
	const width = finite(record.width);
	const height = finite(record.height);
	if (width === undefined || height === undefined) return size;
	const bounds: WindowBounds = {
		// A missing position is the platform's job, not ours.
		...(finite(record.x) === undefined ? {} : { x: finite(record.x) as number }),
		...(finite(record.y) === undefined ? {} : { y: finite(record.y) as number }),
		width: Math.max(MIN_WIDTH, Math.round(width)),
		height: Math.max(MIN_HEIGHT, Math.round(height)),
	};
	if (bounds.x === undefined || bounds.y === undefined) return bounds;
	// A saved size is still useful when the monitor changed, so a rectangle nobody can see keeps its size but loses its
	// position.
	return displays.some((area) => overlaps(bounds, area)) ? bounds : { width: bounds.width, height: bounds.height };
}
