import { defineTelemetrySchema } from "./index.ts";

/**
 * The spans mu writes about one session.
 *
 * What belongs here: identifiers, counts, lengths, durations and outcomes. What must never appear:
 * a prompt, a completion, tool output, a file path, a key. A span is meant to answer "what happened,
 * where did it slow down, what failed" without being able to reconstruct the conversation — the
 * session file and the ledger already hold that, and they are the user's, not the log's.
 *
 * `sensitive: true` marks an attribute the JSONL sink drops entirely; everything else is also run
 * through the host's redaction before it is written.
 */
export const MU_TELEMETRY_SCHEMA = defineTelemetrySchema({
	version: 1,
	spans: {
		turn: {
			description: "One user turn: the message and everything it caused, until mu stopped working on it.",
			parents: { kind: "root_or_external" },
			startAttributes: {
				"session.id": {
					type: "string",
					required: true,
					description: "The session the turn belongs to.",
					cardinality: "high",
				},
				"turn.id": { type: "number", required: true, description: "Turn number within the session, from 1." },
				"turn.message_chars": {
					type: "number",
					required: false,
					description: "How long the user's message was, in characters.",
				},
			},
			endAttributes: {
				"turn.outcome": {
					type: "string",
					values: ["answered", "stopped", "failed", "aborted"],
					description: "How the turn ended.",
				},
				"turn.tool_calls": { type: "number", description: "Tool calls the turn made." },
				"turn.judge_calls": { type: "number", description: "Judge calls the turn made." },
			},
			status: { default: "ok", errorWhen: "turn.outcome" },
		},
		"model.request": {
			description: "One provider request: the model call behind a turn.",
			parents: { kind: "spans", spans: ["turn"] },
			startAttributes: {
				"session.id": { type: "string", required: true, description: "The session the request belongs to." },
				"turn.id": { type: "number", required: false, description: "The turn that asked." },
				"model.provider": { type: "string", required: true, description: "Provider id, e.g. anthropic." },
				"model.id": { type: "string", required: true, description: "Model id as the provider names it." },
			},
			endAttributes: {
				"model.input_tokens": { type: "number", description: "Input tokens the provider reported." },
				"model.output_tokens": { type: "number", description: "Output tokens the provider reported." },
				"model.stop_reason": { type: "string", description: "How the stream ended: stop, length, tool_use…" },
				"model.attempts": { type: "number", description: "Attempts after retries." },
			},
			status: { default: "ok", errorWhen: "model.stop_reason" },
		},
		"tool.call": {
			description: "One tool execution.",
			parents: { kind: "spans", spans: ["turn"] },
			startAttributes: {
				"session.id": { type: "string", required: true, description: "The session the call belongs to." },
				"turn.id": { type: "number", required: false, description: "The turn that asked." },
				"tool.name": { type: "string", required: true, description: "Tool name, e.g. bash or edit." },
				"tool.call_id": {
					type: "string",
					required: false,
					description: "The provider's call id, to join against the transcript.",
					cardinality: "high",
				},
			},
			endAttributes: {
				"tool.outcome": { type: "string", values: ["ok", "error", "aborted"], description: "How it ended." },
				"tool.output_chars": { type: "number", description: "Characters the tool returned, before truncation." },
				"tool.exit_code": { type: "number", description: "Exit code, for the shell tools." },
			},
			status: { default: "ok", errorWhen: "tool.outcome" },
		},
		"judge.decision": {
			description: "One decision point answered by a judge, or by its fallback.",
			parents: { kind: "spans", spans: ["turn"] },
			startAttributes: {
				"session.id": { type: "string", required: true, description: "The session the decision belongs to." },
				"turn.id": { type: "number", required: false, description: "The turn that asked." },
				"decision.id": { type: "string", required: true, description: "Decision point id, e.g. tool.admission." },
				"decision.mode": {
					type: "string",
					values: ["off", "shadow", "active"],
					required: false,
					description: "The mode the point ran in.",
				},
			},
			endAttributes: {
				"decision.source": {
					type: "string",
					values: ["judge", "fallback"],
					description: "Who produced the outcome.",
				},
				"decision.latency_ms": { type: "number", description: "How long the judge took." },
				"decision.tier_count": { type: "number", description: "Tiers that answered." },
				"ledger.id": { type: "string", description: "The ledger record, to join against `mu ledger`." },
				"decision.consent": {
					type: "string",
					values: ["agreed", "refused", "not-required"],
					description: "Whether the remote judge was allowed to run at all.",
				},
				"decision.quota": {
					type: "string",
					values: ["ok", "exhausted"],
					description: "Whether the budget for remote judges still had room.",
				},
			},
			status: { default: "ok", errorWhen: "decision.source" },
		},
		"context.admission": {
			description: "Long tool output judged chunk by chunk before it entered the context.",
			parents: { kind: "spans", spans: ["turn"] },
			startAttributes: {
				"session.id": { type: "string", required: true, description: "The session the output belongs to." },
				"turn.id": { type: "number", required: false, description: "The turn that produced it." },
				"admission.input_chars": { type: "number", required: true, description: "Characters the tool returned." },
			},
			endAttributes: {
				"admission.omitted_chars": { type: "number", description: "Characters replaced by a marker." },
				"admission.chunks": { type: "number", description: "Chunks the output was split into." },
				"admission.waited_ms": { type: "number", description: "How long the result was held for a verdict." },
			},
			status: { default: "ok", errorWhen: "admission.waited_ms" },
		},
		"context.compaction": {
			description: "The context was compacted to fit the window.",
			parents: { kind: "spans", spans: ["turn"] },
			startAttributes: {
				"session.id": { type: "string", required: true, description: "The session being compacted." },
				"turn.id": { type: "number", required: false, description: "The turn it happened in." },
				"compaction.messages": { type: "number", required: true, description: "Messages before compaction." },
			},
			endAttributes: {
				"compaction.summary_chars": { type: "number", description: "Characters the summary took." },
				"compaction.kept_messages": { type: "number", description: "Messages kept verbatim." },
			},
			status: { default: "ok", errorWhen: "compaction.kept_messages" },
		},
		"memory.recall": {
			description: "Lessons recalled for a task.",
			parents: { kind: "spans", spans: ["turn"] },
			startAttributes: {
				"session.id": { type: "string", required: true, description: "The session asking." },
				"turn.id": { type: "number", required: false, description: "The turn asking." },
				"memory.query_chars": { type: "number", required: true, description: "Characters of the task text." },
			},
			endAttributes: {
				"memory.hits": { type: "number", description: "Lessons returned." },
				"memory.used_chars": { type: "number", description: "Characters of the lessons that went in." },
			},
			status: { default: "ok", errorWhen: "memory.hits" },
		},
	},
});

type SchemaSpanDefinition = (typeof MU_TELEMETRY_SCHEMA.spans)[keyof typeof MU_TELEMETRY_SCHEMA.spans];

function spanDefinition(spanName: string): SchemaSpanDefinition | undefined {
	return (MU_TELEMETRY_SCHEMA.spans as Record<string, SchemaSpanDefinition>)[spanName];
}

/** Attribute names a span may carry in one phase, from the schema; a sink keeps only these. */
export function allowedAttributes(spanName: string, phase: "start" | "end"): ReadonlySet<string> {
	const span = spanDefinition(spanName);
	if (!span) return new Set();
	const definitions = phase === "start" ? span.startAttributes : span.endAttributes;
	return new Set(Object.keys(definitions));
}

/** Attributes the schema marks `sensitive`, which no sink may write. */
export function sensitiveAttributes(): ReadonlySet<string> {
	const names = new Set<string>();
	for (const span of Object.values(MU_TELEMETRY_SCHEMA.spans)) {
		for (const definitions of [span.startAttributes, span.endAttributes]) {
			for (const [name, definition] of Object.entries(definitions)) {
				if (definition.sensitive) names.add(name);
			}
		}
	}
	return names;
}
