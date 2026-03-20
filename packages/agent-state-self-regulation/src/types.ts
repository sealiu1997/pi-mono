import type { CompactionResult, ExtensionContext, SessionBeforeCompactEvent } from "@mariozechner/pi-coding-agent";

export const REGULATION_STATE_ENTRY = "agent_state_regulation/state";
export const REGULATION_CONFIG_ENTRY = "agent_state_regulation/config";
export const REGULATION_TRANSITION_ENTRY = "agent_state_regulation/transition";
export const REGULATION_COMPACTION_ENTRY = "agent_state_regulation/compaction";

export const CONTEXT_USAGE_PROBE_KEY = "contextUsage";
export const SYSTEM_MEMORY_PROBE_KEY = "systemMemory";

export type RegulationLevel = "normal" | "tight" | "critical" | "unknown";

export type SuggestedAction = "none" | "compact_light" | "compact_standard" | "compact_aggressive" | "monitor_only";

export type PromptScalar = string | number | boolean | null;
export type PromptFieldMap = Record<string, PromptScalar>;
export type ExtenderPromptFields = Record<string, PromptFieldMap>;

export interface RegulationConfig {
	enabled: boolean;
	injectOnContext: boolean;
	persistTransitionsOnly: boolean;
	suppressHealthyInjection: boolean;
	contextThresholds: {
		tightPercent: number;
		criticalPercent: number;
	};
	systemMemoryAdvisoryOnly: boolean;
	systemMemoryThresholds: {
		tightPercent: number;
		criticalPercent: number;
	};
	probeTtlMs: {
		systemMemory: number;
		customDefault: number;
	};
	compaction: {
		toolEnabled: boolean;
		customProfilesEnabled: boolean;
		interceptHostCompactionByDefault: boolean;
		defaultProfile: string;
	};
}

export interface ProbeResult<T = unknown> {
	key: string;
	sampledAt: number;
	ttlMs: number;
	status: RegulationLevel;
	data: T;
	reason?: string;
	promptData?: PromptFieldMap;
}

export interface ContextUsageSample {
	tokens: number | null;
	contextWindow: number | null;
	percent: number | null;
}

export interface SystemMemorySample {
	totalBytes: number;
	freeBytes: number;
	usedPercent: number;
	processRssBytes: number;
	processHeapUsedBytes: number;
}

export interface ResourceSnapshot {
	contextUsage?: ProbeResult<ContextUsageSample>;
	systemMemory?: ProbeResult<SystemMemorySample>;
	custom: Record<string, ProbeResult>;
}

export type CustomProbeStates = Record<string, ProbeResult>;

export interface StateAssessment {
	version: 1;
	level: RegulationLevel;
	reasons: string[];
	metrics: {
		contextUsagePercent: number | null;
		contextTokens: number | null;
		contextWindow: number | null;
		systemMemoryPercent: number | null;
	};
	suggestedActions: SuggestedAction[];
	selectedProfile?: string;
	generatedAt: number;
}

export interface RegulationStateRecord {
	version: 1;
	lastAssessment?: StateAssessment;
	lastTransitionAt?: number;
	lastProfileUsed?: string;
	customProbeStates?: CustomProbeStates;
}

export interface AssessmentExtenderContext {
	ctx: ExtensionContext;
	snapshot: ResourceSnapshot;
	assessment: StateAssessment;
	currentRecord?: RegulationStateRecord;
	config: RegulationConfig;
}

export interface AssessmentExtenderResult {
	assessment?: StateAssessment;
	promptData?: PromptFieldMap;
}

export interface AssessmentExtender {
	id: string;
	extend(
		context: AssessmentExtenderContext,
	): Promise<AssessmentExtenderResult | undefined> | AssessmentExtenderResult | undefined;
}

export interface RegulationThresholdConfig {
	version: 1;
	contextThresholds: {
		tightPercent: number;
		criticalPercent: number;
	};
	systemMemoryThresholds: {
		tightPercent: number;
		criticalPercent: number;
	};
}

interface CompactionProfileDefinitionBase {
	id: string;
	label: string;
}

export interface DelegateCompactionProfileDefinition extends CompactionProfileDefinitionBase {
	mode: "delegate";
}

export interface InstructionsCompactionProfileDefinition extends CompactionProfileDefinitionBase {
	mode: "instructions";
	customInstructions: string;
}

export interface CustomCompactionProfileExecutionContext {
	ctx: ExtensionContext;
	preparation: SessionBeforeCompactEvent["preparation"];
	branchEntries: SessionBeforeCompactEvent["branchEntries"];
	reason?: string;
	signal: AbortSignal;
}

export interface CustomCompactionProfileDefinition extends CompactionProfileDefinitionBase {
	mode: "custom";
	execute(
		context: CustomCompactionProfileExecutionContext,
	): Promise<CompactionResult | undefined> | CompactionResult | undefined;
}

export type CompactionProfileDefinition =
	| DelegateCompactionProfileDefinition
	| InstructionsCompactionProfileDefinition
	| CustomCompactionProfileDefinition;

export interface SelfRegulationToolInput {
	action: "get_state" | "list_profiles" | "compact" | "set_thresholds" | "new_session";
	profile?: string;
	reason?: string;
	contextTightPercent?: number;
	contextCriticalPercent?: number;
	systemMemoryTightPercent?: number;
	systemMemoryCriticalPercent?: number;
}

export interface SelfRegulationToolDetails {
	action: SelfRegulationToolInput["action"];
	level?: RegulationLevel;
	profile?: string;
	recommendedProfile?: string;
	lastProfileUsed?: string;
	suggestedActions?: SuggestedAction[];
	customProbeStates?: CustomProbeStates;
	thresholds?: RegulationThresholdConfig;
}

export interface StateProbe<T = unknown> {
	key: string;
	ttlMs: number;
	collect(ctx: ExtensionContext): Promise<ProbeResult<T>> | ProbeResult<T>;
}

export interface ScriptProbeDefinition {
	key: string;
	command: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	ttlMs?: number;
	timeoutMs?: number;
	maxOutputBytes?: number;
	maxPromptFields?: number;
	maxPromptValueLength?: number;
}

export interface AgentStateSelfRegulationExtensionOptions {
	config?: Partial<RegulationConfig>;
	customProbes?: StateProbe<unknown>[];
	scriptProbes?: ScriptProbeDefinition[];
	customProfiles?: CompactionProfileDefinition[];
	assessmentExtenders?: AssessmentExtender[];
}

export const REGULATION_LEVEL_RANK: Record<RegulationLevel, number> = {
	unknown: -1,
	normal: 0,
	tight: 1,
	critical: 2,
};

export function compareRegulationLevels(left: RegulationLevel, right: RegulationLevel): number {
	return REGULATION_LEVEL_RANK[left] - REGULATION_LEVEL_RANK[right];
}

export function deriveLevelFromPercent(
	percent: number | null | undefined,
	tightPercent: number,
	criticalPercent: number,
): RegulationLevel {
	if (percent === null || percent === undefined) {
		return "unknown";
	}

	if (percent >= criticalPercent) {
		return "critical";
	}

	if (percent >= tightPercent) {
		return "tight";
	}

	return "normal";
}

export function isRegulationLevel(value: unknown): value is RegulationLevel {
	return value === "normal" || value === "tight" || value === "critical" || value === "unknown";
}

export function isRegulationStateRecord(value: unknown): value is RegulationStateRecord {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const candidate = value as Partial<RegulationStateRecord>;
	return candidate.version === 1;
}

export function isRegulationThresholdConfig(value: unknown): value is RegulationThresholdConfig {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const candidate = value as Partial<RegulationThresholdConfig>;
	if (candidate.version !== 1) {
		return false;
	}

	const contextThresholds = candidate.contextThresholds;
	const systemMemoryThresholds = candidate.systemMemoryThresholds;

	if (typeof contextThresholds !== "object" || contextThresholds === null) {
		return false;
	}

	if (typeof systemMemoryThresholds !== "object" || systemMemoryThresholds === null) {
		return false;
	}

	return (
		typeof contextThresholds.tightPercent === "number" &&
		typeof contextThresholds.criticalPercent === "number" &&
		typeof systemMemoryThresholds.tightPercent === "number" &&
		typeof systemMemoryThresholds.criticalPercent === "number"
	);
}

export function hasActionableRegulationSignal(assessment: StateAssessment): boolean {
	return assessment.reasons.length > 0 || assessment.suggestedActions.some((action) => action !== "none");
}
