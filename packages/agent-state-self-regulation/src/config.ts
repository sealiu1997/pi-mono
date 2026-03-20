import type { RegulationConfig, RegulationThresholdConfig } from "./types.js";

export const DEFAULT_REGULATION_CONFIG: RegulationConfig = {
	enabled: true,
	injectOnContext: true,
	persistTransitionsOnly: true,
	suppressHealthyInjection: true,
	contextThresholds: {
		tightPercent: 70,
		criticalPercent: 85,
	},
	systemMemoryAdvisoryOnly: true,
	systemMemoryThresholds: {
		tightPercent: 75,
		criticalPercent: 90,
	},
	probeTtlMs: {
		systemMemory: 30_000,
		customDefault: 60_000,
	},
	compaction: {
		toolEnabled: true,
		customProfilesEnabled: true,
		interceptHostCompactionByDefault: false,
		defaultProfile: "host-default",
	},
};

export function createRegulationConfig(overrides?: Partial<RegulationConfig>): RegulationConfig {
	if (!overrides) {
		return DEFAULT_REGULATION_CONFIG;
	}

	return {
		...DEFAULT_REGULATION_CONFIG,
		...overrides,
		contextThresholds: {
			...DEFAULT_REGULATION_CONFIG.contextThresholds,
			...overrides.contextThresholds,
		},
		systemMemoryThresholds: {
			...DEFAULT_REGULATION_CONFIG.systemMemoryThresholds,
			...overrides.systemMemoryThresholds,
		},
		probeTtlMs: {
			...DEFAULT_REGULATION_CONFIG.probeTtlMs,
			...overrides.probeTtlMs,
		},
		compaction: {
			...DEFAULT_REGULATION_CONFIG.compaction,
			...overrides.compaction,
		},
	};
}

export function createThresholdConfig(config: RegulationConfig): RegulationThresholdConfig {
	return {
		version: 1,
		contextThresholds: {
			tightPercent: config.contextThresholds.tightPercent,
			criticalPercent: config.contextThresholds.criticalPercent,
		},
		systemMemoryThresholds: {
			tightPercent: config.systemMemoryThresholds.tightPercent,
			criticalPercent: config.systemMemoryThresholds.criticalPercent,
		},
	};
}

export function applyThresholdConfig(target: RegulationConfig, thresholds: RegulationThresholdConfig): void {
	target.contextThresholds.tightPercent = thresholds.contextThresholds.tightPercent;
	target.contextThresholds.criticalPercent = thresholds.contextThresholds.criticalPercent;
	target.systemMemoryThresholds.tightPercent = thresholds.systemMemoryThresholds.tightPercent;
	target.systemMemoryThresholds.criticalPercent = thresholds.systemMemoryThresholds.criticalPercent;
}

export function validateThresholdConfig(thresholds: RegulationThresholdConfig): string | undefined {
	const validationError =
		validateThresholdPair(
			"Context thresholds",
			thresholds.contextThresholds.tightPercent,
			thresholds.contextThresholds.criticalPercent,
		) ??
		validateThresholdPair(
			"System memory thresholds",
			thresholds.systemMemoryThresholds.tightPercent,
			thresholds.systemMemoryThresholds.criticalPercent,
		);

	return validationError;
}

function validateThresholdPair(label: string, tightPercent: number, criticalPercent: number): string | undefined {
	if (!Number.isFinite(tightPercent) || !Number.isFinite(criticalPercent)) {
		return `${label} must be finite numbers.`;
	}

	if (tightPercent < 0 || tightPercent > 100 || criticalPercent < 0 || criticalPercent > 100) {
		return `${label} must be between 0 and 100.`;
	}

	if (tightPercent >= criticalPercent) {
		return `${label} must satisfy tightPercent < criticalPercent.`;
	}

	return undefined;
}
