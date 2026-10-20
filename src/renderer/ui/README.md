# UI primitives

These components are copied into the renderer from the shadcn/ui patterns (MIT), built on Radix UI
(MIT). Icons come from lucide-react (ISC). They are source, not a dependency on a component library's
versioning: change them here when the product needs something different.

Tokens live in `src/renderer/styles.css` and are mapped for Tailwind in `src/renderer/tailwind.css`.
Components use semantic names (`background`, `card`, `primary`, `muted`, `border`, `ring`) rather than
raw colors. The legacy stylesheet is imported in the `legacy` cascade layer so these utilities can
replace one control at a time without a second visual system.
