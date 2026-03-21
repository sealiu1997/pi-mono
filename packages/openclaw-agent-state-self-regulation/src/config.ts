import type { CompactionProfileId, OpenClawAdapterConfig, ThresholdConfig } from "./types.js";

export const DEFAULT_OPENCLAW_ADAPTER_CONFIG: OpenClawAdapterConfig = {
	enabled: true,
	injectRuntimeState: true,
	suppressHealthyInjection: true,
	thresholds: {
		tightPercent: 70,
		criticalPercent: 85,
	},
	defaultProfile: "host-default",
	enableNewSession: true,
};

export const OPENCLAW_CONFIG_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		tightPercent: {
			type: "number",
			minimum: 0,
			maximum: 100,
			default: DEFAULT_OPENCLAW_ADAPTER_CONFIG.thresholds.tightPercent,
		},
		criticalPercent: {
			type: "number",
			minimum: 0,
			maximum: 100,
			default: DEFAULT_OPENCLAW_ADAPTER_CONFIG.thresholds.criticalPercent,
		},
		defaultProfile: {
			type: "string",
			enum: ["host-default", "light", "standard", "aggressive"],
			default: DEFAULT_OPENCLAW_ADAPTER_CONFIG.defaultProfile,
		},
		enableNewSession: {
			type: "boolean",
			default: DEFAULT_OPENCLAW_ADAPTER_CONFIG.enableNewSession,
		},
		injectRuntimeState: {
			type: "boolean",
			default: DEFAULT_OPENCLAW_ADAPTER_CONFIG.injectRuntimeState,
		},
	},
} as const satisfies Record<string, unknown>;

export function createAdapterConfig(overrides?: Partial<OpenClawAdapterConfig>): OpenClawAdapterConfig {
	if (!overrides) {
		return structuredClone(DEFAULT_OPENCLAW_ADAPTER_CONFIG);
	}

	return {
		...DEFAULT_OPENCLAW_ADAPTER_CONFIG,
		...overrides,
		thresholds: {
			...DEFAULT_OPENCLAW_ADAPTER_CONFIG.thresholds,
			...overrides.thresholds,
		},
	};
}

export function normalizePluginConfig(value: unknown): Partial<OpenClawAdapterConfig> {
	if (!isRecord(value)) {
		return {};
	}

	const tightPercent = readFiniteNumber(value.tightPercent);
	const criticalPercent = readFiniteNumber(value.criticalPercent);
	const defaultProfile = readProfile(value.defaultProfile);
	const enableNewSession = readBoolean(value.enableNewSession);
	const injectRuntimeState = readBoolean(value.injectRuntimeState);

	return {
		...(tightPercent !== undefined || criticalPercent !== undefined
			? {
					thresholds: {
						tightPercent: tightPercent ?? DEFAULT_OPENCLAW_ADAPTER_CONFIG.thresholds.tightPercent,
						criticalPercent: criticalPercent ?? DEFAULT_OPENCLAW_ADAPTER_CONFIG.thresholds.criticalPercent,
					},
				}
			: {}),
		...(defaultProfile ? { defaultProfile } : {}),
		...(enableNewSession !== undefined ? { enableNewSession } : {}),
		...(injectRuntimeState !== undefined ? { injectRuntimeState } : {}),
	};
}

export function createThresholdConfig(config: OpenClawAdapterConfig): ThresholdConfig {
	return {
		version: 1,
		tightPercent: config.thresholds.tightPercent,
		criticalPercent: config.thresholds.criticalPercent,
	};
}

export function validateThresholdConfig(thresholds: ThresholdConfig): string | undefined {
	if (!Number.isFinite(thresholds.tightPercent) || !Number.isFinite(thresholds.criticalPercent)) {
		return "Thresholds must be finite numbers.";
	}

	if (
		thresholds.tightPercent < 0 ||
		thresholds.tightPercent > 100 ||
		thresholds.criticalPercent < 0 ||
		thresholds.criticalPercent > 100
	) {
		return "Thresholds must be between 0 and 100.";
	}

	if (thresholds.tightPercent >= thresholds.criticalPercent) {
		return "Thresholds must satisfy tightPercent < criticalPercent.";
	}

	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function readProfile(value: unknown): CompactionProfileId | undefined {
	return value === "host-default" || value === "light" || value === "standard" || value === "aggressive"
		? value
		: undefined;
}
