// Adapted from shadcn/ui (MIT): https://ui.shadcn.com/docs/components/sonner
import { Toaster as Sonner } from "sonner";

export function Toaster(): React.JSX.Element {
	return (
		<Sonner
			theme="dark"
			position="bottom-right"
			closeButton
			toastOptions={{
				style: {
					background: "var(--panel)",
					border: "1px solid var(--line)",
					color: "var(--text)",
					boxShadow: "var(--shadow-2)",
				},
			}}
		/>
	);
}
