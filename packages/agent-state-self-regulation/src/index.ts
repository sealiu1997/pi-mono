import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ContextEvent,
	ContextEventResult,
	ExtensionAPI,
	ExtensionContext,
	SessionBeforeCompactEvent,
	SessionCompactEvent,
} from "@mariozechner/pi-coding-agent";

import { AssessmentEngine } from "./assessment-engine.js";
import {
	requestCompaction as dispatchCompactionRequest,
	runCompactionProfile,
} from "./compaction/compact-dispatcher.js";
import { CompactionProfileRegistry, createDefaultCompactionProfiles } from "./compaction/profiles.js";
import {
	applyThresholdConfig,
	createRegulationConfig,
	createThresholdConfig,
	validateThresholdConfig,
} from "./config.js";
import { ContextUsageProbe } from "./probes/context-usage-probe.js";
import { ProbeRegistry } from "./probes/probe-registry.js";
import { ScriptProbe } from "./probes/script-probe.js";
import { SystemMemoryProbe } from "./probes/system-memory-probe.js";
import { PromptRenderer } from "./prompt-renderer.js";
import { RegulationStateStore } from "./state-store.js";
import { createSelfRegulationTool } from "./tool.js";
import type {
	AgentStateSelfRegulationExtensionOptions,
	AssessmentExtender,
	CompactionProfileDefinition,
	CustomProbeStates,
	ExtenderPromptFields,
	RegulationConfig,
	RegulationStateRecord,
	RegulationThresholdConfig,
	ScriptProbeDefinition,
	SelfRegulationToolInput,
	StateAssessment,
	StateProbe,
	SuggestedAction,
} from "./types.js";

export type {
	AgentStateSelfRegulationExtensionOptions,
	AssessmentExtender,
	CompactionProfileDefinition,
	ExtenderPromptFields,
	PromptFieldMap,
	PromptScalar,
	RegulationConfig,
	RegulationLevel,
	RegulationStateRecord,
	RegulationThresholdConfig,
	ScriptProbeDefinition,
	StateAssessment,
	StateProbe,
	SuggestedAction,
} from "./types.js";

type CompactionRequestSource = "tool" | "intercept";
type SessionControlAction = "new_session";

interface PendingCompactionRequest {
	requestId: number;
	profileId: string;
	reason?: string;
	source: CompactionRequestSource;
}

class AgentStateSelfRegulationExtension {
	private readonly config: RegulationConfig;
	private readonly baseConfig: RegulationConfig;
	private readonly probeRegistry = new ProbeRegistry();
	private readonly assessmentEngine = new AssessmentEngine();
	private readonly assessmentExtenders: AssessmentExtender[];
	private readonly promptRenderer = new PromptRenderer();
	private readonly stateStore = new RegulationStateStore();
	private readonly profileRegistry: CompactionProfileRegistry;
	private currentRecord: RegulationStateRecord | undefined;
	private currentThresholdConfig: RegulationThresholdConfig | undefined;
	private latestAssessment: StateAssessment | undefined;
	private latestCustomProbeStates: CustomProbeStates = {};
	private latestExtenderPromptData: ExtenderPromptFields = {};
	private pendingCompactionRequest: PendingCompactionRequest | undefined;
	private activeCompactionRequest: PendingCompactionRequest | undefined;
	private pendingSessionControlAction: SessionControlAction | undefined;
	private nextCompactionRequestId = 1;

	constructor(
		private readonly pi: ExtensionAPI,
		options: AgentStateSelfRegulationExtensionOptions,
	) {
		this.config = createRegulationConfig(options.config);
		this.baseConfig = structuredClone(this.config);
		this.assessmentExtenders = options.assessmentExtenders ?? [];
		this.profileRegistry = new CompactionProfileRegistry(createDefaultCompactionProfiles());
		this.registerBuiltInProbes();
		this.registerCustomProbes(options.customProbes ?? []);
		this.registerScriptProbes(options.scriptProbes ?? []);
		this.registerCustomProfiles(options.customProfiles ?? []);
	}

	register(): void {
		if (this.config.compaction.toolEnabled) {
			this.pi.registerTool(
				createSelfRegulationTool({
					getState: (ctx, options) => this.getState(ctx, options),
					getProfiles: () => this.profileRegistry.list(),
					getDefaultProfile: () => this.config.compaction.defaultProfile,
					getThresholds: () => this.getThresholds(),
					requestCompaction: (ctx, profileId, reason) => this.requestCompaction(ctx, profileId, reason),
					requestNewSession: (ctx) => this.requestNewSession(ctx),
					setThresholds: (input) => this.setThresholds(input),
				}),
			);
		}

		this.pi.on("session_start", (_event, ctx) => {
			this.loadStateFromContext(ctx);
		});
		this.pi.on("session_switch", (_event, ctx) => {
			this.loadStateFromContext(ctx);
		});
		this.pi.on("session_fork", (_event, ctx) => {
			this.loadStateFromContext(ctx);
		});
		this.pi.on("session_before_compact", (event, ctx) => this.handleBeforeCompact(event, ctx));
		this.pi.on("session_compact", (event, ctx) => this.handleSessionCompact(event, ctx));
		this.pi.on("before_agent_start", (event, _ctx) => this.handleBeforeAgentStart(event));
		this.pi.on("context", (event, ctx) => this.handleContext(event, ctx));
	}

	private registerBuiltInProbes(): void {
		this.probeRegistry.register(new ContextUsageProbe(this.config));
		this.probeRegistry.register(new SystemMemoryProbe(this.config));
	}

	private registerCustomProbes(customProbes: StateProbe<unknown>[]): void {
		for (const probe of customProbes) {
			this.probeRegistry.register(probe);
		}
	}

	private registerScriptProbes(scriptProbes: ScriptProbeDefinition[]): void {
		for (const scriptProbe of scriptProbes) {
			this.probeRegistry.register(new ScriptProbe(scriptProbe));
		}
	}

	private registerCustomProfiles(customProfiles: CompactionProfileDefinition[]): void {
		if (!this.config.compaction.customProfilesEnabled) {
			return;
		}

		for (const profile of customProfiles) {
			this.profileRegistry.register(profile);
		}
	}

	private loadStateFromContext(ctx: ExtensionContext, options?: { clearLatestAssessment?: boolean }): void {
		this.currentThresholdConfig = this.stateStore.loadConfig(ctx) ?? createThresholdConfig(this.baseConfig);
		applyThresholdConfig(this.config, this.currentThresholdConfig);
		this.currentRecord = this.stateStore.load(ctx);
		this.latestAssessment = options?.clearLatestAssessment ? undefined : this.currentRecord?.lastAssessment;
		this.latestCustomProbeStates = this.currentRecord?.customProbeStates
			? structuredClone(this.currentRecord.customProbeStates)
			: {};
		this.latestExtenderPromptData = {};
		this.pendingCompactionRequest = undefined;
		this.activeCompactionRequest = undefined;
		this.pendingSessionControlAction = undefined;
	}

	private handleBeforeAgentStart(event: BeforeAgentStartEvent): BeforeAgentStartEventResult | undefined {
		if (!this.config.enabled) {
			return;
		}

		const guidance = `Runtime self-regulation is available through the self_regulate_context tool. Treat context-window pressure as the primary signal. Treat host-memory signals as advisory only unless the user overrides that policy. Thresholds can be inspected or adjusted explicitly through the tool when the user asks. If the user explicitly wants stronger cleanup than compaction, the tool can request a fresh session through the host's /new-style behavior. ${this.requestResetSession()}`;

		return {
			systemPrompt: `${event.systemPrompt}\n\n${guidance}`,
		};
	}

	private async handleContext(event: ContextEvent, ctx: ExtensionContext): Promise<ContextEventResult | undefined> {
		if (!this.config.enabled) {
			return;
		}

		const assessment = await this.evaluateState(ctx);

		if (!this.config.injectOnContext) {
			return;
		}

		const injectedMessage = this.promptRenderer.render(assessment, this.config, {
			customProbeStates: this.latestCustomProbeStates,
			extenderPromptData: this.latestExtenderPromptData,
		});
		if (!injectedMessage) {
			return;
		}

		return {
			messages: [...event.messages, injectedMessage],
		};
	}

	private async handleBeforeCompact(event: SessionBeforeCompactEvent, ctx: ExtensionContext) {
		const request = this.resolveCompactionRequest(event);
		if (!request) {
			return;
		}

		const profile = this.resolveRegisteredProfile(request.profileId);
		if (!profile) {
			this.clearCompactionRequest(request.requestId);
			return;
		}

		this.activeCompactionRequest = request;

		try {
			const compaction = await runCompactionProfile(ctx, event, profile, request.reason);
			return compaction ? { compaction } : undefined;
		} catch (error) {
			this.clearCompactionRequest(request.requestId);
			throw error;
		}
	}

	private handleSessionCompact(event: SessionCompactEvent, ctx: ExtensionContext): void {
		const activeRequest = this.activeCompactionRequest;
		if (activeRequest) {
			const executedAt = Date.parse(event.compactionEntry.timestamp);
			this.currentRecord = this.stateStore.recordCompactionExecution(
				this.pi,
				this.currentRecord,
				activeRequest.profileId,
				activeRequest.reason,
				Number.isNaN(executedAt) ? Date.now() : executedAt,
			);
		}

		this.pendingCompactionRequest = undefined;
		this.activeCompactionRequest = undefined;
		this.loadStateFromContext(ctx, { clearLatestAssessment: true });
	}

	private requestCompaction(ctx: ExtensionContext, profileId: string | undefined, reason?: string): string {
		if (this.pendingCompactionRequest || this.activeCompactionRequest) {
			return "A compaction request is already in flight.";
		}

		const resolvedProfileId = profileId ?? this.config.compaction.defaultProfile;
		const profile = profileId
			? this.resolveRegisteredProfile(profileId)
			: this.resolveConfiguredProfile(this.config.compaction.defaultProfile);
		if (!profile) {
			return `Unknown compaction profile "${resolvedProfileId}". Use self_regulate_context with action=list_profiles to inspect available profiles.`;
		}

		const request = this.createCompactionRequest(profile.id, reason, "tool");
		this.pendingCompactionRequest = request;

		return dispatchCompactionRequest(ctx, profile, {
			onComplete: () => this.clearCompactionRequest(request.requestId),
			onError: () => this.clearCompactionRequest(request.requestId),
		});
	}

	private requestNewSession(ctx: ExtensionContext): string {
		return this.queueSessionControl(ctx, "new_session");
	}

	private requestResetSession(): string {
		return "reset_session is reserved for future host-level in-place reset support and is not exposed in the current tool surface.";
	}

	private async getState(
		ctx: ExtensionContext,
		options?: { refresh?: boolean },
	): Promise<RegulationStateRecord | undefined> {
		if (options?.refresh || !this.latestAssessment) {
			await this.evaluateState(ctx);
		}

		return this.buildRuntimeStateRecord();
	}

	private async evaluateState(ctx: ExtensionContext): Promise<StateAssessment> {
		const snapshot = await this.probeRegistry.collectSnapshot(ctx);
		const baseAssessment = this.assessmentEngine.evaluate(snapshot, this.config);
		const { assessment, promptData } = await this.runAssessmentExtenders(ctx, snapshot, baseAssessment);
		const nextRecord = this.stateStore.updateFromAssessment(this.currentRecord, assessment, snapshot.custom);

		this.latestAssessment = assessment;
		this.latestCustomProbeStates = structuredClone(snapshot.custom);
		this.latestExtenderPromptData = promptData;
		this.currentRecord = this.stateStore.saveIfChanged(
			this.pi,
			this.currentRecord,
			nextRecord,
			this.config.persistTransitionsOnly,
		);

		return assessment;
	}

	private async runAssessmentExtenders(
		ctx: ExtensionContext,
		snapshot: Awaited<ReturnType<ProbeRegistry["collectSnapshot"]>>,
		baseAssessment: StateAssessment,
	): Promise<{ assessment: StateAssessment; promptData: ExtenderPromptFields }> {
		let assessment = baseAssessment;
		const promptData: ExtenderPromptFields = {};

		for (const extender of this.assessmentExtenders) {
			try {
				const result = await extender.extend({
					ctx,
					snapshot,
					assessment: structuredClone(assessment),
					currentRecord: this.currentRecord,
					config: this.config,
				});
				if (!result) {
					continue;
				}

				if (result.assessment) {
					assessment = result.assessment;
				}

				if (result.promptData && Object.keys(result.promptData).length > 0) {
					promptData[extender.id] = structuredClone(result.promptData);
				}
			} catch (error) {
				assessment = this.mergeAssessmentExtenderFailure(assessment, extender.id, error);
			}
		}

		return { assessment, promptData };
	}

	private mergeAssessmentExtenderFailure(
		assessment: StateAssessment,
		extenderId: string,
		error: unknown,
	): StateAssessment {
		const message = error instanceof Error ? error.message : String(error);
		const failureReason = `Assessment extender "${extenderId}" failed: ${message.slice(0, 160)}`;
		if (assessment.reasons.includes(failureReason)) {
			return assessment;
		}

		const suggestedActions: SuggestedAction[] = assessment.suggestedActions.includes("monitor_only")
			? assessment.suggestedActions
			: [...assessment.suggestedActions, "monitor_only"];

		return {
			...assessment,
			reasons: [...assessment.reasons, failureReason],
			suggestedActions,
		};
	}

	private queueSessionControl(ctx: ExtensionContext, action: SessionControlAction): string {
		if (this.pendingSessionControlAction) {
			return "A session cleanup request is already in flight.";
		}

		if (!ctx.requestNewSession) {
			return "Fresh-session requests are not available in this host runtime.";
		}

		this.pendingSessionControlAction = action;
		ctx.requestNewSession({
			onComplete: () => {
				this.pendingSessionControlAction = undefined;
			},
			onError: () => {
				this.pendingSessionControlAction = undefined;
			},
		});

		return "Queued a fresh session request using pi-mono's built-in /new behavior. The current turn will be interrupted once the host processes the request.";
	}

	private buildRuntimeStateRecord(): RegulationStateRecord | undefined {
		const latestAssessment = this.latestAssessment ?? this.currentRecord?.lastAssessment;
		if (!latestAssessment && !this.currentRecord) {
			return undefined;
		}

		return {
			version: 1,
			lastAssessment: latestAssessment,
			lastTransitionAt: this.currentRecord?.lastTransitionAt,
			lastProfileUsed: this.currentRecord?.lastProfileUsed,
			customProbeStates: this.latestCustomProbeStates,
		};
	}

	private getThresholds(): RegulationThresholdConfig {
		if (!this.currentThresholdConfig) {
			this.currentThresholdConfig = createThresholdConfig(this.config);
		}

		return structuredClone(this.currentThresholdConfig);
	}

	private setThresholds(input: Omit<SelfRegulationToolInput, "action" | "profile" | "reason">): {
		message: string;
		thresholds: RegulationThresholdConfig;
	} {
		const hasInput =
			input.contextTightPercent !== undefined ||
			input.contextCriticalPercent !== undefined ||
			input.systemMemoryTightPercent !== undefined ||
			input.systemMemoryCriticalPercent !== undefined;

		const currentThresholds = this.getThresholds();
		if (!hasInput) {
			return {
				message: `No threshold values were provided. ${this.formatThresholdSummary(currentThresholds)}`,
				thresholds: currentThresholds,
			};
		}

		const nextThresholds: RegulationThresholdConfig = {
			version: 1,
			contextThresholds: {
				tightPercent: input.contextTightPercent ?? currentThresholds.contextThresholds.tightPercent,
				criticalPercent: input.contextCriticalPercent ?? currentThresholds.contextThresholds.criticalPercent,
			},
			systemMemoryThresholds: {
				tightPercent: input.systemMemoryTightPercent ?? currentThresholds.systemMemoryThresholds.tightPercent,
				criticalPercent:
					input.systemMemoryCriticalPercent ?? currentThresholds.systemMemoryThresholds.criticalPercent,
			},
		};

		const validationError = validateThresholdConfig(nextThresholds);
		if (validationError) {
			return {
				message: `${validationError} ${this.formatThresholdSummary(currentThresholds)}`,
				thresholds: currentThresholds,
			};
		}

		this.currentThresholdConfig = this.stateStore.saveConfig(this.pi, this.currentThresholdConfig, nextThresholds);
		applyThresholdConfig(this.config, this.currentThresholdConfig);

		return {
			message: `Updated regulation thresholds. ${this.formatThresholdSummary(this.currentThresholdConfig)}`,
			thresholds: structuredClone(this.currentThresholdConfig),
		};
	}

	private resolveRegisteredProfile(profileId: string): CompactionProfileDefinition | undefined {
		return this.profileRegistry.resolve(profileId);
	}

	private resolveConfiguredProfile(profileId: string): CompactionProfileDefinition | undefined {
		return this.resolveRegisteredProfile(profileId) ?? this.resolveRegisteredProfile("host-default");
	}

	private createCompactionRequest(
		profileId: string,
		reason: string | undefined,
		source: CompactionRequestSource,
	): PendingCompactionRequest {
		return {
			requestId: this.nextCompactionRequestId++,
			profileId,
			reason,
			source,
		};
	}

	private resolveCompactionRequest(event: SessionBeforeCompactEvent): PendingCompactionRequest | undefined {
		if (this.pendingCompactionRequest) {
			const request = this.pendingCompactionRequest;
			this.pendingCompactionRequest = undefined;
			return request;
		}

		if (event.customInstructions !== undefined || !this.config.compaction.interceptHostCompactionByDefault) {
			return undefined;
		}

		const profile = this.resolveConfiguredProfile(this.config.compaction.defaultProfile);
		if (!profile) {
			return undefined;
		}

		return this.createCompactionRequest(profile.id, undefined, "intercept");
	}

	private clearCompactionRequest(requestId: number): void {
		if (this.pendingCompactionRequest?.requestId === requestId) {
			this.pendingCompactionRequest = undefined;
		}

		if (this.activeCompactionRequest?.requestId === requestId) {
			this.activeCompactionRequest = undefined;
		}
	}

	private formatThresholdSummary(thresholds: RegulationThresholdConfig): string {
		return `Context tight=${thresholds.contextThresholds.tightPercent}, critical=${thresholds.contextThresholds.criticalPercent}; system memory tight=${thresholds.systemMemoryThresholds.tightPercent}, critical=${thresholds.systemMemoryThresholds.criticalPercent}.`;
	}
}

export function createAgentStateSelfRegulationExtension(
	options: AgentStateSelfRegulationExtensionOptions = {},
): (pi: ExtensionAPI) => void {
	return (pi: ExtensionAPI) => {
		new AgentStateSelfRegulationExtension(pi, options).register();
	};
}
