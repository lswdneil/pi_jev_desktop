// SPDX-License-Identifier: MIT
// Copyright (c) 2026 the spec.ai.jev authors

/**
 * The subset of pi's JSONL protocol used by this shell.
 *
 * The runtime remains mu/pi; these structural types keep the standalone desktop build independent of a local checkout.
 * When the upstream protocol changes, update this file and the reducer/supervisor together.
 */

export type PromptDisposition = "started" | "queued" | "handled";

export interface RpcImage {
	readonly type: "image";
	readonly data: string;
	readonly mimeType: string;
}

export type RpcCommand =
	| { readonly id?: string; readonly type: "prompt"; readonly message: string; readonly images?: readonly RpcImage[]; readonly streamingBehavior?: "steer" | "followUp" }
	| { readonly id?: string; readonly type: "steer"; readonly message: string; readonly images?: readonly RpcImage[] }
	| { readonly id?: string; readonly type: "follow_up"; readonly message: string; readonly images?: readonly RpcImage[] }
	| { readonly id?: string; readonly type: "abort" }
	| { readonly id?: string; readonly type: "clear_queue" }
	| { readonly id?: string; readonly type: "new_session"; readonly parentSession?: string }
	| { readonly id?: string; readonly type: "get_state" }
	| { readonly id?: string; readonly type: "set_model"; readonly provider: string; readonly modelId: string }
	| { readonly id?: string; readonly type: "cycle_model" }
	| { readonly id?: string; readonly type: "get_available_models" }
	| { readonly id?: string; readonly type: "get_messages" }
	| { readonly id?: string; readonly type: "switch_session"; readonly sessionPath: string }
	| { readonly id?: string; readonly type: "set_session_name"; readonly name: string }
	| { readonly id?: string; readonly type: "set_thinking_level"; readonly level: string }
	| { readonly id?: string; readonly type: "compact"; readonly customInstructions?: string }
	| { readonly id?: string; readonly type: "bash"; readonly command: string; readonly excludeFromContext?: boolean }
	| { readonly id?: string; readonly type: "abort_bash" }
	| { readonly id?: string; readonly type: string };

export interface RpcModel {
	readonly provider: string;
	readonly id: string;
	readonly contextWindow?: number;
}

export interface RpcSessionState {
	readonly model?: RpcModel;
	readonly thinkingLevel: string;
	readonly isStreaming: boolean;
	readonly isCompacting?: boolean;
	readonly sessionId: string;
	readonly sessionFile?: string;
	readonly sessionName?: string;
	readonly messageCount: number;
	readonly pendingMessageCount?: number;
}

export type RpcResponse =
	| { readonly id?: string; readonly type: "response"; readonly command: "prompt"; readonly success: true; readonly data: { readonly disposition: PromptDisposition } }
	| { readonly id?: string; readonly type: "response"; readonly command: "get_state"; readonly success: true; readonly data: RpcSessionState }
	| { readonly id?: string; readonly type: "response"; readonly command: "get_messages"; readonly success: true; readonly data: { readonly messages: readonly unknown[] } }
	| { readonly id?: string; readonly type: "response"; readonly command: "new_session"; readonly success: true; readonly data: { readonly cancelled: boolean } }
	| { readonly id?: string; readonly type: "response"; readonly command: "get_available_models"; readonly success: true; readonly data: { readonly models: readonly RpcModel[] } }
	| { readonly id?: string; readonly type: "response"; readonly command: "switch_session"; readonly success: true; readonly data: { readonly cancelled: boolean } }
	| { readonly id?: string; readonly type: "response"; readonly command: "set_session_name"; readonly success: true }
	| { readonly id?: string; readonly type: "response"; readonly command: string; readonly success: true; readonly data?: unknown }
	| { readonly id?: string; readonly type: "response"; readonly command: string; readonly success: false; readonly error: string };

export type JsonAgentSessionEvent = {
	readonly type: string;
	readonly [key: string]: unknown;
};

export type RpcExtensionUIRequest =
	| { readonly type: "extension_ui_request"; readonly id: string; readonly method: "select"; readonly title: string; readonly options: readonly string[]; readonly timeout?: number }
	| { readonly type: "extension_ui_request"; readonly id: string; readonly method: "confirm"; readonly title: string; readonly message: string; readonly timeout?: number }
	| { readonly type: "extension_ui_request"; readonly id: string; readonly method: "input"; readonly title: string; readonly placeholder?: string; readonly timeout?: number }
	| { readonly type: "extension_ui_request"; readonly id: string; readonly method: "editor"; readonly title: string; readonly prefill?: string }
	| { readonly type: "extension_ui_request"; readonly id: string; readonly method: "notify"; readonly message: string; readonly notifyType?: "info" | "warning" | "error" }
	| { readonly type: "extension_ui_request"; readonly id: string; readonly method: "setStatus"; readonly statusKey: string; readonly statusText?: string }
	| { readonly type: "extension_ui_request"; readonly id: string; readonly method: "setWidget"; readonly widgetKey: string; readonly widgetLines?: readonly string[] }
	| { readonly type: "extension_ui_request"; readonly id: string; readonly method: "setTitle"; readonly title: string }
	| { readonly type: "extension_ui_request"; readonly id: string; readonly method: "set_editor_text"; readonly text: string };

export type RpcExtensionUIResponse =
	| { readonly type: "extension_ui_response"; readonly id: string; readonly value: string }
	| { readonly type: "extension_ui_response"; readonly id: string; readonly confirmed: boolean }
	| { readonly type: "extension_ui_response"; readonly id: string; readonly cancelled: true };
