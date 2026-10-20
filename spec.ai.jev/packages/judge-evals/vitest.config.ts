import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.base.ts";

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			include: ["test/**/*.test.ts"],
			// The corpus and the archive are files on disk; no provider is contacted by the tests.
			env: { PI_OFFLINE: "1", SPEC_AI_JEV_JUDGE: "" },
		},
	}),
);
