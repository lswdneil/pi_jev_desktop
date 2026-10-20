// Adapted from shadcn/ui (MIT): https://ui.shadcn.com/docs/components/button
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/utils.ts";

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground hover:brightness-95",
				secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
				outline: "border border-border bg-transparent text-foreground hover:bg-accent",
				ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
				destructive: "bg-destructive text-destructive-foreground hover:brightness-95",
				link: "text-primary underline-offset-4 hover:underline",
			},
			size: {
				default: "h-9 px-3.5 text-[13px]",
				sm: "h-8 rounded-[8px] px-2.5 text-[12px]",
				lg: "h-10 rounded-[12px] px-4 text-[13px]",
				icon: "size-8 rounded-[9px]",
				"icon-sm": "size-7 rounded-[8px]",
			},
		},
		defaultVariants: { variant: "default", size: "default" },
	},
);

export interface ButtonProps
	extends ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	readonly asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps): React.JSX.Element {
	const Component = asChild ? Slot : "button";
	return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
