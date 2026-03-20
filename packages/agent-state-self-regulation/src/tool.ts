import type { ExtensionContext, ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";

import type {
	CompactionProfileDefinition,
	RegulationStateRecord,
	RegulationThresholdConfig,
	SelfRegulationToolDetails,
	SelfRegulationToolInput,
} from "./types.js";

const SELF_REGULATION_TOOL_ACTION = Type.Union(
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

const SELF_REGULATION_TOOL_PARAMETERS = Type.Object({
	action: SELF_REGULATION_TOOL_ACTION,
	profile: Type.Optional(Type.String({ description: "Compaction profile id when action=compact." })),
	reason: Type.Optional(
		Type.String({ description: "Optional reason or user instruction for the compaction request." }),
	),
	contextTightPercent: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
	contextCriticalPercent: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
	systemMemoryTightPercent: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
	systemMemoryCriticalPercent: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
});

type SelfRegulationToolParams = Static<typeof SELF_REGULATION_TOOL_PARAMETERS>;

interface SelfRegulationToolDependencies {
	getState(ctx: ExtensionContext, options?: { refresh?: boolean }): Promise<RegulationStateRecord | undefined>;
	getProfiles(): CompactionProfileDefinition[];
	getDefaultProfile(): string;
	getThresholds(): RegulationThresholdConfig;
	requestCompaction(ctx: ExtensionContext, profileId: string | undefined, reason?: string): string;
	requestNewSession(ctx: ExtensionContext): string;
	setThresholds(input: Omit<SelfRegulationToolInput, "action" | "profile" | "reason">): {
		message: string;
		thresholds: RegulationThresholdConfig;
	};
}

function formatAssessment(record: RegulationStateRecord | undefined, thresholds: RegulationThresholdConfig): string {
	const assessment = record?.lastAssessment;
	if (!assessment) {
		return [
			"No regulation assessment is available yet.",
			formatThresholds(thresholds),
			formatCustomProbeStates(record),
		].join("\n");
	}

	const reasons = assessment.reasons.length > 0 ? assessment.reasons.join(" ") : "No active warnings.";
	const customProbeStates = formatCustomProbeStates(record);
	return [
		`Level: ${assessment.level}`,
		`Context usage percent: ${assessment.metrics.contextUsagePercent?.toFixed(1) ?? "unknown"}`,
		`Context usage tokens: ${assessment.metrics.contextTokens ?? "unknown"}`,
		`Context window: ${assessment.metrics.contextWindow ?? "unknown"}`,
		`System memory percent (advisory): ${assessment.metrics.systemMemoryPercent?.toFixed(1) ?? "unknown"}`,
		`Recommended profile: ${assessment.selectedProfile ?? "none"}`,
		`Last executed profile: ${record?.lastProfileUsed ?? "none"}`,
		`Suggested actions: ${assessment.suggestedActions.join(", ")}`,
		`Reasons: ${reasons}`,
		formatThresholds(thresholds),
		customProbeStates,
	].join("\n");
}

function formatThresholds(thresholds: RegulationThresholdConfig): string {
	return [
		`Context thresholds: tight=${thresholds.contextThresholds.tightPercent}, critical=${thresholds.contextThresholds.criticalPercent}`,
		`System memory thresholds: tight=${thresholds.systemMemoryThresholds.tightPercent}, critical=${thresholds.systemMemoryThresholds.criticalPercent}`,
	].join("\n");
}

function formatCustomProbeStates(record: RegulationStateRecord | undefined): string {
	const customProbeStates = record?.customProbeStates;
	if (!customProbeStates || Object.keys(customProbeStates).length === 0) {
		return "Custom probes: none";
	}

	const formatted = Object.entries(customProbeStates)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, state]) => `${key}=${state.status}`)
		.join(", ");

	return `Custom probes: ${formatted}`;
}

function formatProfiles(profiles: CompactionProfileDefinition[]): string {
	if (profiles.length === 0) {
		return "No compaction profiles are registered.";
	}

	return profiles
		.map((profile) => {
			const modeSuffix = profile.mode === "delegate" ? "default host behavior" : profile.mode;
			return `- ${profile.id}: ${profile.label} (${modeSuffix})`;
		})
		.join("\n");
}

export function createSelfRegulationTool(
	dependencies: SelfRegulationToolDependencies,
): ToolDefinition<typeof SELF_REGULATION_TOOL_PARAMETERS, SelfRegulationToolDetails> {
	return {
		name: "self_regulate_context",
		label: "Self Regulate Context",
		description:
			"Inspect runtime regulation state, request an explicit compaction profile, or request a fresh session when the user authorizes stronger context cleanup.",
		promptSnippet:
			"Use self_regulate_context to inspect context pressure, inspect advisory host-memory signals, request an explicit compaction profile, or request a fresh session through the host's /new-style behavior when the user explicitly allows stronger cleanup.",
		parameters: SELF_REGULATION_TOOL_PARAMETERS,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const typedParams = params as SelfRegulationToolParams;
			const action = typedParams.action as SelfRegulationToolInput["action"];

			switch (action) {
				case "get_state": {
					const currentState = await dependencies.getState(ctx, { refresh: true });
					const thresholds = dependencies.getThresholds();
					return {
						content: [{ type: "text", text: formatAssessment(currentState, thresholds) }],
						details: {
							action,
							level: currentState?.lastAssessment?.level,
							recommendedProfile: currentState?.lastAssessment?.selectedProfile,
							lastProfileUsed: currentState?.lastProfileUsed,
							suggestedActions: currentState?.lastAssessment?.suggestedActions,
							customProbeStates: currentState?.customProbeStates,
							thresholds,
						},
					};
				}
				case "list_profiles": {
					const profiles = dependencies.getProfiles();
					return {
						content: [{ type: "text", text: formatProfiles(profiles) }],
						details: {
							action,
						},
					};
				}
				case "compact": {
					const currentState = await dependencies.getState(ctx);
					const profileId = typedParams.profile ?? dependencies.getDefaultProfile();
					const message = dependencies.requestCompaction(ctx, profileId, typedParams.reason);
					const thresholds = dependencies.getThresholds();
					return {
						content: [{ type: "text", text: message }],
						details: {
							action,
							level: currentState?.lastAssessment?.level,
							profile: profileId,
							recommendedProfile: currentState?.lastAssessment?.selectedProfile,
							lastProfileUsed: currentState?.lastProfileUsed,
							customProbeStates: currentState?.customProbeStates,
							thresholds,
						},
					};
				}
				case "new_session": {
					const currentState = await dependencies.getState(ctx);
					const message = dependencies.requestNewSession(ctx);
					const thresholds = dependencies.getThresholds();
					return {
						content: [{ type: "text", text: message }],
						details: {
							action,
							level: currentState?.lastAssessment?.level,
							recommendedProfile: currentState?.lastAssessment?.selectedProfile,
							lastProfileUsed: currentState?.lastProfileUsed,
							customProbeStates: currentState?.customProbeStates,
							thresholds,
						},
					};
				}
				case "set_thresholds": {
					const result = dependencies.setThresholds({
						contextTightPercent: typedParams.contextTightPercent,
						contextCriticalPercent: typedParams.contextCriticalPercent,
						systemMemoryTightPercent: typedParams.systemMemoryTightPercent,
						systemMemoryCriticalPercent: typedParams.systemMemoryCriticalPercent,
					});

					return {
						content: [{ type: "text", text: result.message }],
						details: {
							action,
							thresholds: result.thresholds,
						},
					};
				}
			}

			const exhaustiveAction: never = action;
			throw new Error(`Unsupported self-regulation action: ${exhaustiveAction}`);
		},
	};
}
