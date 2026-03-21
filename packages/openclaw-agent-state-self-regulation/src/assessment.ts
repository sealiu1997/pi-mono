import {
	type CompactionProfileId,
	compareRegulationLevels,
	type HostCapabilities,
	type OpenClawAssessment,
	type ProbeResult,
	type RegulationLevel,
	type RuntimeContextUsage,
	type SuggestedAction,
	type ThresholdConfig,
} from "./types.js";

export class OpenClawAssessmentEngine {
	evaluate(params: {
		contextUsage: RuntimeContextUsage;
		messageCount: number | null;
		thresholds: ThresholdConfig;
		defaultProfile: CompactionProfileId;
		capabilities: HostCapabilities;
		probeStates: Record<string, ProbeResult>;
		lastCompactionTokenCount: number | null;
		lastCompactedCount: number | null;
	}): OpenClawAssessment {
		const reasons: string[] = [];
		const suggestedActions = new Set<SuggestedAction>();
		const usageLevel = deriveUsageLevel(params.contextUsage, params.thresholds);
		let level: RegulationLevel = usageLevel;

		const probeEntries = Object.entries(params.probeStates).sort(([left], [right]) => left.localeCompare(right));
		for (const [key, probeState] of probeEntries) {
			if (level === "unknown" && compareRegulationLevels(probeState.status, level) > 0) {
				level = probeState.status;
			}

			if (probeState.status === "tight" || probeState.status === "critical") {
				reasons.push(probeState.reason ?? `Probe "${key}" reported ${probeState.status} pressure.`);
			}
		}

		if (level === "unknown" && probeEntries.length > 0) {
			level = "normal";
		}

		if (params.contextUsage.source === "unknown" || params.contextUsage.percent === null) {
			reasons.unshift("Context usage is currently unavailable; using best-effort fallback signals only.");
		} else if (usageLevel === "tight") {
			reasons.unshift(
				`Context window usage is in the tight range (${params.contextUsage.percent.toFixed(1)}%, source=${params.contextUsage.source}).`,
			);
		} else if (usageLevel === "critical") {
			reasons.unshift(
				`Context window usage is in the critical range (${params.contextUsage.percent.toFixed(1)}%, source=${params.contextUsage.source}).`,
			);
		}

		let selectedProfile: CompactionProfileId | undefined;
		if (level === "tight") {
			selectedProfile = params.defaultProfile === "host-default" ? "light" : params.defaultProfile;
		} else if (level === "critical") {
			selectedProfile = params.defaultProfile === "host-default" ? "standard" : params.defaultProfile;
		}

		if (level === "tight") {
			if (params.capabilities.directCompaction) {
				suggestedActions.add("compact_light");
			} else {
				suggestedActions.add("monitor_only");
			}
		} else if (level === "critical") {
			if (params.capabilities.directNewSession) {
				suggestedActions.add("new_session");
			}
			if (params.capabilities.directCompaction) {
				suggestedActions.add("compact_standard");
				suggestedActions.add("compact_aggressive");
			} else {
				suggestedActions.add("monitor_only");
			}
		} else {
			suggestedActions.add("none");
		}

		return {
			version: 1,
			level,
			reasons,
			metrics: {
				contextUsagePercent: params.contextUsage.percent,
				contextTokens: params.contextUsage.tokens,
				contextWindow: params.contextUsage.contextWindow,
				contextUsageSource: params.contextUsage.source,
				messageCount: params.messageCount,
				compactingCount: null,
				lastCompactionTokenCount: params.lastCompactionTokenCount,
				lastCompactedCount: params.lastCompactedCount,
			},
			suggestedActions: [...suggestedActions],
			selectedProfile,
			generatedAt: Date.now(),
		};
	}
}

function deriveUsageLevel(contextUsage: RuntimeContextUsage, thresholds: ThresholdConfig): RegulationLevel {
	if (contextUsage.percent === null || contextUsage.source === "unknown") {
		return "unknown";
	}

	if (contextUsage.percent >= thresholds.criticalPercent) {
		return "critical";
	}

	if (contextUsage.percent >= thresholds.tightPercent) {
		return "tight";
	}

	return "normal";
}
