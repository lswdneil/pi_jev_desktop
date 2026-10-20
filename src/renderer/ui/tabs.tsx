// Adapted from shadcn/ui (MIT): https://ui.shadcn.com/docs/components/tabs
import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils.ts";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>): React.JSX.Element {
	return (
		<TabsPrimitive.List
			className={cn("inline-flex h-9 items-center gap-1 rounded-[10px] border border-border bg-[var(--rail)] p-1", className)}
			{...props}
		/>
	);
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>): React.JSX.Element {
	return (
		<TabsPrimitive.Trigger
			className={cn(
				"inline-flex h-7 items-center justify-center rounded-[7px] px-3 text-[12px] font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground",
				className,
			)}
			{...props}
		/>
	);
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>): React.JSX.Element {
	return <TabsPrimitive.Content className={cn("outline-none", className)} {...props} />;
}
