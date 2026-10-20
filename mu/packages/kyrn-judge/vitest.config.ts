import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig, { workspaceSourcePaths } from "../../vitest.base.ts";

// The extension test drives a real AgentSession through coding-agent's faux-provider
// harness, so workspace packages must resolve to their sources like they do there.
export default mergeConfig(
	baseConfig,
	defineConfig({
		resolve: {
			// The extension imports runtime values from pi, which the base config does not alias,
			// and the Google sign-in reuses pi-ai's Google message conversion from its api/ modules.
			alias: [
				{ find: /^@earendil-works\/pi-coding-agent$/, replacement: workspaceSourcePaths.codingAgentIndex },
				{
					find: /^@earendil-works\/pi-ai\/api\/(.+)$/,
					replacement: `${workspaceSourcePaths.aiIndex.replace(/index\.ts$/, "api")}/$1.ts`,
				},
			],
		},
		test: {
			environment: "node",
			testTimeout: 30000,
			env: { PI_OFFLINE: "1" },
			unstubEnvs: true,
			// The gate is `scripts/check-coverage.mjs`, which compares this summary against `coverage-baseline.json`;
			// the setting only takes effect with `--coverage`, so a normal test run pays nothing for it.
			coverage: {
				provider: "v8",
				reporter: ["json-summary"],
				reportsDirectory: "coverage",
				include: ["src/**/*.ts"],
			},
			server: {
				deps: {
					external: [/@silvia-odwyer\/photon-node/],
				},
			},
		},
	}),
);
