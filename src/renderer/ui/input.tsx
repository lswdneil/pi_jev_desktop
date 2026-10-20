// Adapted from shadcn/ui (MIT): https://ui.shadcn.com/docs/components/input
import type { InputHTMLAttributes } from "react";
import { cn } from "../lib/utils.ts";

export function Input({ className, type, ...props }: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
	return (
		<input
			type={type}
			className={cn(
				"h-9 w-full rounded-[10px] border border-input bg-[var(--rail)] px-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}
