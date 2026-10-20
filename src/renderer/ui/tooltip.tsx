// Adapted from shadcn/ui (MIT): https://ui.shadcn.com/docs/components/tooltip
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils.ts";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
	className,
	sideOffset = 6,
	...props
}: ComponentProps<typeof TooltipPrimitive.Content>): React.JSX.Element {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Content
				sideOffset={sideOffset}
				className={cn(
					"z-50 rounded-[7px] border border-border bg-[var(--panel-2)] px-2 py-1 text-[11px] text-foreground shadow-[var(--shadow-1)]",
					className,
				)}
				{...props}
			/>
		</TooltipPrimitive.Portal>
	);
}
