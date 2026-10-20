// Adapted from shadcn/ui (MIT): https://ui.shadcn.com/docs/components/switch
import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils.ts";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>): React.JSX.Element {
	return (
		<SwitchPrimitive.Root
			className={cn(
				"peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border bg-[var(--panel-2)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-[var(--text)] shadow-[var(--shadow-1)] transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
		</SwitchPrimitive.Root>
	);
}
