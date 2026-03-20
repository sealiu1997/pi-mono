import type { RegulationConfig, RegulationLevel, ResourceSnapshot, StateAssessment, SuggestedAction } from "./types.js";

export class AssessmentEngine {
	evaluate(snapshot: ResourceSnapshot, config: RegulationConfig): StateAssessment {
		const reasons: string[] = [];
		const suggestedActions = new Set<SuggestedAction>();

		const contextProbe = snapshot.contextUsage;
		const memoryProbe = snapshot.systemMemory;

		let level: RegulationLevel = contextProbe?.status ?? "unknown";
		let selectedProfile: string | undefined;

		const contextPercent = contextProbe?.data.percent ?? null;
		const contextTokens = contextProbe?.data.tokens ?? null;
		const contextWindow = contextProbe?.data.contextWindow ?? null;
		const systemMemoryPercent = memoryProbe?.data.usedPercent ?? null;

		switch (contextProbe?.status) {
			case "critical":
				reasons.push("Context window usage is in the critical range.");
				suggestedActions.add("compact_standard");
				suggestedActions.add("compact_aggressive");
				selectedProfile = "standard";
				break;
			case "tight":
				reasons.push("Context window usage is in the tight range.");
				suggestedActions.add("compact_light");
				selectedProfile = "light";
				break;
			case "unknown":
			case undefined:
				level = "unknown";
				reasons.push("Context usage is currently unavailable.");
				suggestedActions.add("monitor_only");
				break;
			default:
				break;
		}

		if (memoryProbe && memoryProbe.status !== "normal" && memoryProbe.status !== "unknown") {
			reasons.push(`Host memory pressure is ${memoryProbe.status}; treat this as an advisory signal only.`);
			suggestedActions.add("monitor_only");

			if (!config.systemMemoryAdvisoryOnly && level === "normal") {
				level = memoryProbe.status;
			}
		}

		if (suggestedActions.size === 0) {
			suggestedActions.add("none");
		}

		return {
			version: 1,
			level,
			reasons,
			metrics: {
				contextUsagePercent: contextPercent,
				contextTokens,
				contextWindow,
				systemMemoryPercent,
			},
			suggestedActions: [...suggestedActions],
			selectedProfile,
			generatedAt: Date.now(),
		};
	}
}
