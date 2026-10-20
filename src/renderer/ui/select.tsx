// Adapted from shadcn/ui (MIT): https://ui.shadcn.com/docs/components/select
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils.ts";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
	className,
	children,
	...props
}: ComponentProps<typeof SelectPrimitive.Trigger>): React.JSX.Element {
	return (
		<SelectPrimitive.Trigger
			className={cn(
				"flex h-9 w-full items-center justify-between gap-2 rounded-[10px] border border-input bg-[var(--rail)] px-3 text-[13px] text-foreground outline-none transition-colors hover:border-[var(--edge)] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate",
				className,
			)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon asChild>
				<ChevronDown className="size-4 text-muted-foreground" />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
}

export function SelectContent({
	className,
	children,
	position = "popper",
	...props
}: ComponentProps<typeof SelectPrimitive.Content>): React.JSX.Element {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				position={position}
				className={cn(
					"z-50 max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[10rem] overflow-hidden rounded-[12px] border border-border bg-popover text-popover-foreground shadow-[var(--shadow-2)]",
					position === "popper" && "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
					className,
				)}
				{...props}
			>
				<SelectPrimitive.ScrollUpButton className="flex h-7 items-center justify-center text-muted-foreground">
					<ChevronUp className="size-4" />
				</SelectPrimitive.ScrollUpButton>
				<SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
				<SelectPrimitive.ScrollDownButton className="flex h-7 items-center justify-center text-muted-foreground">
					<ChevronDown className="size-4" />
				</SelectPrimitive.ScrollDownButton>
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	);
}

export function SelectLabel({ className, ...props }: ComponentProps<typeof SelectPrimitive.Label>): React.JSX.Element {
	return <SelectPrimitive.Label className={cn("px-2 py-1.5 text-[11px] font-medium text-muted-foreground", className)} {...props} />;
}

export function SelectItem({
	className,
	children,
	...props
}: ComponentProps<typeof SelectPrimitive.Item>): React.JSX.Element {
	return (
		<SelectPrimitive.Item
			className={cn(
				"relative flex w-full cursor-default select-none items-center rounded-[8px] py-2 pl-8 pr-2 text-[13px] outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50",
				className,
			)}
			{...props}
		>
			<span className="absolute left-2 flex size-4 items-center justify-center">
				<SelectPrimitive.ItemIndicator>
					<Check className="size-4 text-primary" />
				</SelectPrimitive.ItemIndicator>
			</span>
			<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
		</SelectPrimitive.Item>
	);
}

export function SelectSeparator({ className, ...props }: ComponentProps<typeof SelectPrimitive.Separator>): React.JSX.Element {
	return <SelectPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}
