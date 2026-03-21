import type { AgentTool } from "@mariozechner/pi-agent-core";

export type RegulationLevel = "normal" | "tight" | "critical" | "unknown";
export type SuggestedAction =
	| "none"
	| "compact_light"
	| "compact_standard"
	| "compact_aggressive"
	| "new_session"
	| "monitor_only";
export type CompactionProfileId = "host-default" | "light" | "standard" | "aggressive";
export type PromptScalar = string | number | boolean | null;
export type PromptFieldMap = Record<string, PromptScalar>;
export type ExtenderPromptFields = Record<string, PromptFieldMap>;

export interface OpenClawAdapterConfig {
	enabled: boolean;
	injectRuntimeState: boolean;
	suppressHealthyInjection: boolean;
	thresholds: {
		tightPercent: number;
		criticalPercent: number;
	};
	defaultProfile: CompactionProfileId;
	enableNewSession: boolean;
}

export interface ThresholdConfig {
	version: 1;
	tightPercent: number;
	criticalPercent: number;
}

export interface RuntimeContextUsage {
	tokens: number | null;
	contextWindow: number | null;
	percent: number | null;
	source: "usage" | "estimate" | "unknown";
	sampledAt: number;
}

export interface GetContextUsageOptions {
	sessionKey?: string;
	sessionId?: string;
}

export interface RuntimeCompactionRequest {
	sessionKey?: string;
	sessionId?: string;
	profile?: CompactionProfileId;
	customInstructions?: string;
	reason?: string;
	replaceInstructions?: boolean;
	onComplete?: () => void;
	onError?: (error: unknown) => void;
}

export interface RuntimeNewSessionRequest {
	sessionKey?: string;
	sessionId?: string;
	reason?: string;
	handoffSummary?: string;
	onComplete?: () => void;
	onError?: (error: unknown) => void;
}

export interface HostCapabilities {
	contextWindowUsage: boolean;
	promptInjection: boolean;
	compactionObservation: boolean;
	resetObservation: boolean;
	directCompaction: boolean;
	directNewSession: boolean;
	scriptProbes: boolean;
	assessmentExtenders: boolean;
	sessionPersistence: boolean;
}

export interface ProbeResult<T = Record<string, unknown>> {
	key: string;
	sampledAt: number;
	ttlMs: number;
	status: RegulationLevel;
	data: T;
	reason?: string;
	promptData?: PromptFieldMap;
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

export interface ScriptProbeContext {
	workspaceDir?: string;
}

export interface OpenClawAssessment {
	version: 1;
	level: RegulationLevel;
	reasons: string[];
	metrics: {
		contextUsagePercent: number | null;
		contextTokens: number | null;
		contextWindow: number | null;
		contextUsageSource: RuntimeContextUsage["source"];
		messageCount: number | null;
		compactingCount: number | null;
		lastCompactionTokenCount: number | null;
		lastCompactedCount: number | null;
	};
	suggestedActions: SuggestedAction[];
	selectedProfile?: CompactionProfileId;
	generatedAt: number;
}

export interface SessionCompactionObservation {
	timestamp: number;
	messageCount: number;
	compactingCount: number | null;
	tokenCount: number | null;
	compactedCount: number | null;
	sessionFile?: string;
}

export interface SessionResetObservation {
	timestamp: number;
	reason?: string;
	sessionFile?: string;
}

export interface SessionStateRecord {
	version: 1;
	thresholds: ThresholdConfig;
	capabilities: HostCapabilities;
	lastAssessment?: OpenClawAssessment;
	lastContextUsage?: RuntimeContextUsage;
	probeStates: Record<string, ProbeResult>;
	promptData: ExtenderPromptFields;
	lastPromptBuild?: {
		timestamp: number;
		messageCount: number;
	};
	lastRequest?: {
		kind: "compact" | "new_session";
		requestedAt: number;
		status: "queued" | "completed" | "failed";
		profile?: CompactionProfileId;
		reason?: string;
		error?: string;
	};
	lastCompaction?: SessionCompactionObservation;
	lastReset?: SessionResetObservation;
}

export interface AssessmentExtenderContext {
	assessment: OpenClawAssessment;
	probeStates: Record<string, ProbeResult>;
	session: SessionStateRecord;
	capabilities: HostCapabilities;
}

export interface AssessmentExtenderResult {
	assessment?: OpenClawAssessment;
	promptData?: PromptFieldMap;
}

export interface AssessmentExtender {
	id: string;
	extend(
		context: AssessmentExtenderContext,
	): Promise<AssessmentExtenderResult | undefined> | AssessmentExtenderResult | undefined;
}

export interface OpenClawAdapterOptions {
	config?: Partial<OpenClawAdapterConfig>;
	scriptProbes?: ScriptProbeDefinition[];
	assessmentExtenders?: AssessmentExtender[];
}

export type OpenClawPluginHookName =
	| "before_prompt_build"
	| "before_compaction"
	| "after_compaction"
	| "before_reset"
	| "session_start";

export interface OpenClawPluginHookAgentContext {
	agentId?: string;
	sessionKey?: string;
	sessionId?: string;
	workspaceDir?: string;
	messageProvider?: string;
	trigger?: string;
	channelId?: string;
}

export interface OpenClawBeforePromptBuildEvent {
	prompt: string;
	messages: unknown[];
}

export interface OpenClawBeforePromptBuildResult {
	systemPrompt?: string;
	prependContext?: string;
	prependSystemContext?: string;
	appendSystemContext?: string;
}

export interface OpenClawBeforeCompactionEvent {
	messageCount: number;
	compactingCount?: number;
	tokenCount?: number;
	messages?: unknown[];
	sessionFile?: string;
}

export interface OpenClawAfterCompactionEvent {
	messageCount: number;
	tokenCount?: number;
	compactedCount: number;
	sessionFile?: string;
}

export interface OpenClawBeforeResetEvent {
	sessionFile?: string;
	messages?: unknown[];
	reason?: string;
}

export interface OpenClawSessionStartEvent {
	sessionId: string;
	sessionKey?: string;
	resumedFrom?: string;
}

export interface OpenClawPluginToolContext {
	config?: unknown;
	workspaceDir?: string;
	agentDir?: string;
	agentId?: string;
	sessionKey?: string;
	sessionId?: string;
	messageChannel?: string;
	agentAccountId?: string;
	requesterSenderId?: string;
	senderIsOwner?: boolean;
	sandboxed?: boolean;
}

export interface OpenClawPluginLogger {
	debug?: (message: string) => void;
	info: (message: string) => void;
	warn: (message: string) => void;
	error: (message: string) => void;
}

export interface OpenClawPluginRuntime {
	agent?: {
		getContextUsage?: (options?: GetContextUsageOptions) => Promise<RuntimeContextUsage>;
		requestCompaction?: (request?: RuntimeCompactionRequest) => void;
		requestNewSession?: (request?: RuntimeNewSessionRequest) => void;
		session?: {
			resolveStorePath?: unknown;
			loadSessionStore?: unknown;
			saveSessionStore?: unknown;
			resolveSessionFilePath?: unknown;
		};
	};
}

// OpenClaw's plugin tool registry accepts heterogeneous tool schemas through AgentTool<any, unknown>.
export type OpenClawAgentTool = AgentTool<any, unknown> & {
	ownerOnly?: boolean;
	promptSnippet?: string;
	promptGuidelines?: string[];
};

export type OpenClawToolFactory = (
	ctx: OpenClawPluginToolContext,
) => OpenClawAgentTool | OpenClawAgentTool[] | null | undefined;

export interface OpenClawPluginApi {
	id: string;
	name: string;
	version?: string;
	description?: string;
	source: string;
	rootDir?: string;
	registrationMode: string;
	config: unknown;
	pluginConfig?: Record<string, unknown>;
	runtime?: OpenClawPluginRuntime;
	logger: OpenClawPluginLogger;
	registerTool: (
		tool: OpenClawAgentTool | OpenClawToolFactory,
		opts?: { name?: string; names?: string[]; optional?: boolean },
	) => void;
	on: <K extends OpenClawPluginHookName>(
		hookName: K,
		handler: OpenClawPluginHookHandlerMap[K],
		opts?: { priority?: number },
	) => void;
}

export interface OpenClawPluginDefinition {
	id: string;
	name: string;
	description: string;
	register: (api: OpenClawPluginApi) => void | Promise<void>;
}

export interface SelfRegulationToolInput {
	action: "get_state" | "list_profiles" | "compact" | "set_thresholds" | "new_session";
	profile?: string;
	reason?: string;
	customInstructions?: string;
	handoffSummary?: string;
	tightPercent?: number;
	criticalPercent?: number;
}

export interface SelfRegulationToolDetails {
	action: SelfRegulationToolInput["action"];
	level?: RegulationLevel;
	profile?: string;
	recommendedProfile?: CompactionProfileId;
	suggestedActions?: SuggestedAction[];
	thresholds?: ThresholdConfig;
	capabilities?: HostCapabilities;
}

export interface SelfRegulationToolState {
	sessionKey: string;
	record: SessionStateRecord;
}

export type OpenClawPluginHookHandlerMap = {
	before_prompt_build: (
		event: OpenClawBeforePromptBuildEvent,
		ctx: OpenClawPluginHookAgentContext,
	) => Promise<OpenClawBeforePromptBuildResult | undefined> | OpenClawBeforePromptBuildResult | undefined;
	before_compaction: (
		event: OpenClawBeforeCompactionEvent,
		ctx: OpenClawPluginHookAgentContext,
	) => Promise<void> | void;
	after_compaction: (event: OpenClawAfterCompactionEvent, ctx: OpenClawPluginHookAgentContext) => Promise<void> | void;
	before_reset: (event: OpenClawBeforeResetEvent, ctx: OpenClawPluginHookAgentContext) => Promise<void> | void;
	session_start: (event: OpenClawSessionStartEvent, ctx: OpenClawPluginHookAgentContext) => Promise<void> | void;
};

export const REGULATION_LEVEL_RANK: Record<RegulationLevel, number> = {
	unknown: -1,
	normal: 0,
	tight: 1,
	critical: 2,
};

export function compareRegulationLevels(left: RegulationLevel, right: RegulationLevel): number {
	return REGULATION_LEVEL_RANK[left] - REGULATION_LEVEL_RANK[right];
}

export function isRegulationLevel(value: unknown): value is RegulationLevel {
	return value === "normal" || value === "tight" || value === "critical" || value === "unknown";
}

export function hasActionableRegulationSignal(assessment: OpenClawAssessment): boolean {
	return assessment.reasons.length > 0 || assessment.suggestedActions.some((action) => action !== "none");
}
