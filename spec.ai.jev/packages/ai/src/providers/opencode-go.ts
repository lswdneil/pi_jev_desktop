import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { googleGenerativeAIApi } from "../api/google-generative-ai.lazy.ts";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { openAIResponsesApi } from "../api/openai-responses.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { OPENCODE_GO_MODELS } from "./opencode-go.models.ts";
import { withOpenCodeSessionHeader } from "./opencode-headers.ts";

export function opencodeGoProvider(): Provider<
	"anthropic-messages" | "openai-completions" | "openai-responses" | "google-generative-ai"
> {
	return createProvider<"anthropic-messages" | "openai-completions" | "openai-responses" | "google-generative-ai">({
		id: "opencode-go",
		name: "OpenCode Go",
		auth: { apiKey: envApiKeyAuth("OpenCode API key", ["OPENCODE_API_KEY"]) },
		models: Object.values(OPENCODE_GO_MODELS),
		api: {
			"anthropic-messages": withOpenCodeSessionHeader(anthropicMessagesApi()),
			"openai-completions": withOpenCodeSessionHeader(openAICompletionsApi()),
			"openai-responses": withOpenCodeSessionHeader(openAIResponsesApi()),
			// The catalog lists Gemini models for this provider; the Google API reads model.baseUrl.
			"google-generative-ai": withOpenCodeSessionHeader(googleGenerativeAIApi()),
		},
	});
}
