import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";

import type {
	CompactionProfileId,
	HostCapabilities,
	OpenClawAgentTool,
	OpenClawPluginToolContext,
	SelfRegulationToolDetails,
	SelfRegulationToolInput,
	SessionStateRecord,
	ThresholdConfig,
} from "./types.js";

const TOOL_ACTION = Type.Union(
	[
		Type.Literal("get_state"),
		Type.Literal("list_profiles"),
		Type.Literal("compact"),
		Type.Literal("set_thresholds"),
		Type.Literal("new_session"),
	],
	{
		description: "Self-regulation action to execute.",
	},
);

const TOOL_PARAMETERS = Type.Object({
	action: TOOL_ACTION,
	profile: Type.Optional(Type.String({ description: "Compaction profile id when action=compact." })),
	reason: Type.Optional(Type.String({ description: "Optional reason for the requested action." })),
	customInstructions: Type.Optional(Type.String({ description: "Optional compaction guidance when action=compact." })),
	handoffSummary: Type.Optional(
		Type.String({ description: "Optional explicit handoff summary when action=new_session." }),
	),
	tightPercent: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
	criticalPercent: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
});

type ToolParams = Static<typeof TOOL_PARAMETERS>;

export interface OpenClawSelfRegulationToolDependencies {
	getState(ctx: OpenClawPluginToolContext, options?: { refresh?: boolean }): Promise<SessionStateRecord>;
	listProfiles(): Array<{ id: CompactionProfileId; label: string; note: string }>;
	setThresholds(
		ctx: OpenClawPluginToolContext,
		input: Pick<SelfRegulationToolInput, "tightPercent" | "criticalPercent">,
	): {
		message: string;
		thresholds: ThresholdConfig;
	};
	requestCompaction(
		ctx: OpenClawPluginToolContext,
		input: Pick<SelfRegulationToolInput, "profile" | "reason" | "customInstructions">,
	): string;
	requestNewSession(
		ctx: OpenClawPluginToolContext,
		input: Pick<SelfRegulationToolInput, "reason" | "handoffSummary">,
	): string;
}

export function createSelfRegulationToolFactory(
	dependencies: OpenClawSelfRegulationToolDependencies,
): (ctx: OpenClawPluginToolContext) => OpenClawAgentTool {
	return (ctx: OpenClawPluginToolContext) => ({
		name: "self_regulate_context",
		label: "Self Regulate Context",
		description:
			"Inspect runtime state, inspect host capability gates, adjust thresholds, and request host-managed session cleanup actions when available.",
		promptSnippet:
			"Use self_regulate_context to inspect runtime state, host capability gates, and adapter-owned pressure signals before deciding whether stronger cleanup is needed.",
		parameters: TOOL_PARAMETERS,
		execute: async (_toolCallId, params) => {
			return await executeTool(dependencies, ctx, params as ToolParams);
		},
	});
}

async function executeTool(
	dependencies: OpenClawSelfRegulationToolDependencies,
	ctx: OpenClawPluginToolContext,
	params: ToolParams,
): Promise<AgentToolResult<SelfRegulationToolDetails>> {
	const action = params.action as SelfRegulationToolInput["action"];

	switch (action) {
		case "get_state": {
			const state = await dependencies.getState(ctx, { refresh: true });
			return textResult(formatState(state), {
				action,
				level: state.lastAssessment?.level,
				recommendedProfile: state.lastAssessment?.selectedProfile,
				suggestedActions: state.lastAssessment?.suggestedActions,
				thresholds: state.thresholds,
				capabilities: state.capabilities,
			});
		}
		case "list_profiles": {
			const lines = dependencies
				.listProfiles()
				.map((profile) => `- ${profile.id}: ${profile.label} (${profile.note})`)
				.join("\n");
			return textResult(lines, { action });
		}
		case "compact": {
			const state = await dependencies.getState(ctx);
			return textResult(
				dependencies.requestCompaction(ctx, {
					profile: params.profile,
					reason: params.reason,
					customInstructions: params.customInstructions,
				}),
				{
					action,
					profile: params.profile,
					level: state.lastAssessment?.level,
					recommendedProfile: state.lastAssessment?.selectedProfile,
					suggestedActions: state.lastAssessment?.suggestedActions,
					thresholds: state.thresholds,
					capabilities: state.capabilities,
				},
			);
		}
		case "new_session": {
			const state = await dependencies.getState(ctx);
			return textResult(
				dependencies.requestNewSession(ctx, {
					reason: params.reason,
					handoffSummary: params.handoffSummary,
				}),
				{
					action,
					level: state.lastAssessment?.level,
					recommendedProfile: state.lastAssessment?.selectedProfile,
					suggestedActions: state.lastAssessment?.suggestedActions,
					thresholds: state.thresholds,
					capabilities: state.capabilities,
				},
			);
		}
		case "set_thresholds": {
			const result = dependencies.setThresholds(ctx, {
				tightPercent: params.tightPercent,
				criticalPercent: params.criticalPercent,
			});
			return textResult(result.message, {
				action,
				thresholds: result.thresholds,
			});
		}
	}

	const exhaustiveAction: never = action;
	throw new Error(`Unsupported self-regulation action: ${exhaustiveAction}`);
}

function formatState(record: SessionStateRecord): string {
	const assessment = record.lastAssessment;
	return [
		`Level: ${assessment?.level ?? "unknown"}`,
		`Context usage percent: ${formatNullableNumber(assessment?.metrics.contextUsagePercent, 1)}`,
		`Context tokens: ${formatNullableNumber(assessment?.metrics.contextTokens)}`,
		`Context window: ${formatNullableNumber(assessment?.metrics.contextWindow)}`,
		`Context usage source: ${assessment?.metrics.contextUsageSource ?? record.lastContextUsage?.source ?? "unknown"}`,
		`Message count: ${assessment?.metrics.messageCount ?? record.lastPromptBuild?.messageCount ?? "unknown"}`,
		`Last compaction token count: ${assessment?.metrics.lastCompactionTokenCount ?? "unknown"}`,
		`Last compacted count: ${assessment?.metrics.lastCompactedCount ?? "unknown"}`,
		`Last request: ${formatLastRequest(record)}`,
		`Recommended profile: ${assessment?.selectedProfile ?? "none"}`,
		`Suggested actions: ${assessment?.suggestedActions.join(", ") ?? "none"}`,
		formatThresholds(record.thresholds),
		formatCapabilities(record.capabilities),
	].join("\n");
}

function formatThresholds(thresholds: ThresholdConfig): string {
	return `Thresholds: tight=${thresholds.tightPercent}, critical=${thresholds.criticalPercent}`;
}

function formatCapabilities(capabilities: HostCapabilities): string {
	return [
		"Capabilities:",
		`  promptInjection=${capabilities.promptInjection}`,
		`  contextWindowUsage=${capabilities.contextWindowUsage}`,
		`  directCompaction=${capabilities.directCompaction}`,
		`  directNewSession=${capabilities.directNewSession}`,
		`  scriptProbes=${capabilities.scriptProbes}`,
		`  assessmentExtenders=${capabilities.assessmentExtenders}`,
	].join("\n");
}

function textResult(text: string, details: SelfRegulationToolDetails): AgentToolResult<SelfRegulationToolDetails> {
	return {
		content: [{ type: "text", text }],
		details,
	};
}

function formatLastRequest(record: SessionStateRecord): string {
	const lastRequest = record.lastRequest;
	if (!lastRequest) {
		return "none";
	}

	return [
		lastRequest.kind,
		lastRequest.status,
		lastRequest.profile ? `profile=${lastRequest.profile}` : undefined,
		lastRequest.reason ? `reason=${lastRequest.reason}` : undefined,
		lastRequest.error ? `error=${lastRequest.error}` : undefined,
	]
		.filter(Boolean)
		.join(", ");
}

function formatNullableNumber(value: number | null | undefined, digits?: number): string {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return "unknown";
	}

	return digits !== undefined ? value.toFixed(digits) : String(value);
}
