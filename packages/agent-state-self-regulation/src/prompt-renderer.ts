import type { ContextEventResult } from "@mariozechner/pi-coding-agent";

import {
	type CustomProbeStates,
	type ExtenderPromptFields,
	hasActionableRegulationSignal,
	type RegulationConfig,
	type StateAssessment,
} from "./types.js";

const MAX_REASONS = 2;
const MAX_PROMPT_FIELDS = 6;

type ContextMessage = NonNullable<ContextEventResult["messages"]>[number];

export class PromptRenderer {
	render(
		assessment: StateAssessment,
		config: RegulationConfig,
		options?: { customProbeStates?: CustomProbeStates; extenderPromptData?: ExtenderPromptFields },
	): ContextMessage | undefined {
		const customPromptFields = this.renderCustomPromptFields(options?.customProbeStates, options?.extenderPromptData);
		if (
			config.suppressHealthyInjection &&
			assessment.level === "normal" &&
			!hasActionableRegulationSignal(assessment) &&
			customPromptFields.length === 0
		) {
			return undefined;
		}

		const lines = [
			"Runtime state for this model call. Treat this as execution metadata, not as a user request.",
			`<agent_runtime_state level="${assessment.level}">`,
			...this.renderReasons(assessment),
			...this.renderMetrics(assessment),
			...this.renderRecommendation(assessment),
			...customPromptFields,
			`  <suggested_actions>${assessment.suggestedActions.join(", ")}</suggested_actions>`,
			`</agent_runtime_state>`,
		];

		const message: ContextMessage = {
			role: "custom",
			customType: "agent_state_regulation/runtime_state",
			content: lines.join("\n"),
			display: false,
			details: assessment,
			timestamp: Date.now(),
		};

		return message;
	}

	private renderReasons(assessment: StateAssessment): string[] {
		return assessment.reasons.slice(0, MAX_REASONS).map((reason) => `  <reason>${reason}</reason>`);
	}

	private renderMetrics(assessment: StateAssessment): string[] {
		const metrics: string[] = [];
		if (assessment.metrics.contextUsagePercent !== null) {
			metrics.push(
				`  <metric name="context_usage_percent">${assessment.metrics.contextUsagePercent.toFixed(1)}</metric>`,
			);
		}
		if (assessment.metrics.contextTokens !== null) {
			metrics.push(`  <metric name="context_tokens">${assessment.metrics.contextTokens}</metric>`);
		}
		if (assessment.metrics.contextWindow !== null) {
			metrics.push(`  <metric name="context_window">${assessment.metrics.contextWindow}</metric>`);
		}
		if (assessment.metrics.systemMemoryPercent !== null) {
			metrics.push(
				`  <metric name="system_memory_percent" advisory="true">${assessment.metrics.systemMemoryPercent.toFixed(1)}</metric>`,
			);
		}
		return metrics;
	}

	private renderRecommendation(assessment: StateAssessment): string[] {
		if (!assessment.selectedProfile) {
			return [];
		}

		return [`  <recommended_profile>${assessment.selectedProfile}</recommended_profile>`];
	}

	private renderCustomPromptFields(
		customProbeStates: CustomProbeStates | undefined,
		extenderPromptData: ExtenderPromptFields | undefined,
	): string[] {
		const lines: string[] = [];
		const sources = new Map<string, Record<string, unknown>>();
		if (customProbeStates) {
			for (const [probeKey, probeState] of Object.entries(customProbeStates)) {
				if (probeState.promptData) {
					sources.set(probeKey, probeState.promptData);
				}
			}
		}
		if (extenderPromptData) {
			for (const [extenderId, promptData] of Object.entries(extenderPromptData)) {
				sources.set(extenderId, promptData);
			}
		}

		const sortedProbeEntries = [...sources.entries()].sort(([left], [right]) => left.localeCompare(right));

		for (const [probeKey, probeState] of sortedProbeEntries) {
			const promptEntries = Object.entries(probeState).sort(([left], [right]) => left.localeCompare(right));
			for (const [field, value] of promptEntries) {
				lines.push(
					`  <custom_field name="${escapeXml(`${probeKey}.${field}`)}">${escapeXml(String(value))}</custom_field>`,
				);
				if (lines.length >= MAX_PROMPT_FIELDS) {
					return lines;
				}
			}
		}

		return lines;
	}
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}
