// Adapted from shadcn/ui (MIT): https://ui.shadcn.com/docs/components/separator
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils.ts";

export function Separator({
	className,
	orientation = "horizontal",
	decorative = true,
	...props
}: ComponentProps<typeof SeparatorPrimitive.Root>): React.JSX.Element {
	return (
		<SeparatorPrimitive.Root
			decorative={decorative}
			orientation={orientation}
			className={cn("shrink-0 bg-border", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)}
			{...props}
		/>
	);
}
