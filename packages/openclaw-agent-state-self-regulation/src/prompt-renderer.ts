import {
	type ExtenderPromptFields,
	hasActionableRegulationSignal,
	type OpenClawAdapterConfig,
	type OpenClawAssessment,
	type ProbeResult,
} from "./types.js";

const MAX_REASONS = 2;
const MAX_PROMPT_FIELDS = 6;

export class OpenClawPromptRenderer {
	render(
		assessment: OpenClawAssessment,
		config: OpenClawAdapterConfig,
		options?: {
			probeStates?: Record<string, ProbeResult>;
			promptData?: ExtenderPromptFields;
		},
	): string | undefined {
		const customPromptFields = this.renderCustomPromptFields(options?.probeStates, options?.promptData);
		if (
			config.suppressHealthyInjection &&
			(assessment.level === "normal" || assessment.level === "unknown") &&
			!hasActionableRegulationSignal(assessment) &&
			customPromptFields.length === 0
		) {
			return undefined;
		}

		const lines = [
			"Runtime state for this model call. Treat this as execution metadata, not as a user request.",
			`<agent_runtime_state host="openclaw" level="${assessment.level}">`,
			...this.renderReasons(assessment),
			...this.renderMetrics(assessment),
			...this.renderRecommendation(assessment),
			...customPromptFields,
			`  <suggested_actions>${assessment.suggestedActions.join(", ")}</suggested_actions>`,
			"</agent_runtime_state>",
		];

		return lines.join("\n");
	}

	private renderReasons(assessment: OpenClawAssessment): string[] {
		return assessment.reasons.slice(0, MAX_REASONS).map((reason) => `  <reason>${escapeXml(reason)}</reason>`);
	}

	private renderMetrics(assessment: OpenClawAssessment): string[] {
		const lines: string[] = [];
		if (assessment.metrics.contextUsagePercent !== null) {
			lines.push(
				`  <metric name="context_usage_percent">${assessment.metrics.contextUsagePercent.toFixed(1)}</metric>`,
			);
		}
		if (assessment.metrics.contextTokens !== null) {
			lines.push(`  <metric name="context_tokens">${assessment.metrics.contextTokens}</metric>`);
		}
		if (assessment.metrics.contextWindow !== null) {
			lines.push(`  <metric name="context_window">${assessment.metrics.contextWindow}</metric>`);
		}
		lines.push(`  <metric name="context_usage_source">${assessment.metrics.contextUsageSource}</metric>`);
		if (assessment.metrics.messageCount !== null) {
			lines.push(`  <metric name="message_count">${assessment.metrics.messageCount}</metric>`);
		}
		if (assessment.metrics.lastCompactionTokenCount !== null) {
			lines.push(
				`  <metric name="last_compaction_token_count">${assessment.metrics.lastCompactionTokenCount}</metric>`,
			);
		}
		if (assessment.metrics.lastCompactedCount !== null) {
			lines.push(`  <metric name="last_compacted_count">${assessment.metrics.lastCompactedCount}</metric>`);
		}
		return lines;
	}

	private renderRecommendation(assessment: OpenClawAssessment): string[] {
		if (!assessment.selectedProfile) {
			return [];
		}

		return [`  <recommended_profile>${assessment.selectedProfile}</recommended_profile>`];
	}

	private renderCustomPromptFields(
		probeStates: Record<string, ProbeResult> | undefined,
		promptData: ExtenderPromptFields | undefined,
	): string[] {
		const lines: string[] = [];
		const sources = new Map<string, Record<string, unknown>>();
		if (probeStates) {
			for (const [probeKey, probeState] of Object.entries(probeStates)) {
				if (probeState.promptData) {
					sources.set(probeKey, probeState.promptData);
				}
			}
		}
		if (promptData) {
			for (const [key, value] of Object.entries(promptData)) {
				sources.set(key, value);
			}
		}

		const sortedEntries = [...sources.entries()].sort(([left], [right]) => left.localeCompare(right));
		for (const [sourceKey, sourceValue] of sortedEntries) {
			const promptEntries = Object.entries(sourceValue).sort(([left], [right]) => left.localeCompare(right));
			for (const [field, value] of promptEntries) {
				lines.push(
					`  <custom_field name="${escapeXml(`${sourceKey}.${field}`)}">${escapeXml(String(value))}</custom_field>`,
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
