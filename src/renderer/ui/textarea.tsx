// Adapted from shadcn/ui (MIT): https://ui.shadcn.com/docs/components/textarea
import type { TextareaHTMLAttributes } from "react";
import { cn } from "../lib/utils.ts";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
	return (
		<textarea
			className={cn(
				"min-h-[88px] w-full resize-none rounded-[12px] border border-input bg-[var(--rail)] px-3.5 py-3 text-[13.5px] leading-6 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}
