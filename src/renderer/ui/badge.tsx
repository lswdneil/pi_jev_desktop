// Adapted from shadcn/ui (MIT): https://ui.shadcn.com/docs/components/badge
import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils.ts";

const badgeVariants = cva(
	"inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
	{
		variants: {
			variant: {
				default: "border-primary/35 bg-primary/10 text-primary",
				secondary: "border-border bg-secondary text-muted-foreground",
				warning: "border-[var(--warn)]/35 bg-[var(--warn)]/10 text-[var(--warn)]",
				destructive: "border-destructive/35 bg-destructive/10 text-destructive",
			},
		},
		defaultVariants: { variant: "default" },
	},
);

export function Badge({
	className,
	variant,
	...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>): React.JSX.Element {
	return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
