import { OpenClawAssessmentEngine } from "./assessment.js";
import {
	createAdapterConfig,
	DEFAULT_OPENCLAW_ADAPTER_CONFIG,
	normalizePluginConfig,
	validateThresholdConfig,
} from "./config.js";
import { buildHandoffSummary } from "./handoff-summary.js";
import { OpenClawPromptRenderer } from "./prompt-renderer.js";
import { detectHostCapabilities, OpenClawRuntimeAgentFacade } from "./runtime-bridge.js";
import { ScriptProbeRunner } from "./script-probe.js";
import { OpenClawSessionStateStore } from "./session-state-store.js";
import { createSelfRegulationToolFactory } from "./tool.js";
import type {
	AssessmentExtender,
	CompactionProfileId,
	ExtenderPromptFields,
	OpenClawAdapterOptions,
	OpenClawAssessment,
	OpenClawPluginApi,
	OpenClawPluginDefinition,
	OpenClawPluginHookAgentContext,
	OpenClawPluginToolContext,
	ProbeResult,
	RuntimeContextUsage,
	SelfRegulationToolInput,
	SessionStateRecord,
	ThresholdConfig,
} from "./types.js";

const COMPACTION_PROFILES: Array<{ id: CompactionProfileId; label: string; note: string }> = [
	{
		id: "host-default",
		label: "Host Default",
		note: "Delegates to the host once OpenClaw exposes a direct compaction seam.",
	},
	{
		id: "light",
		label: "Light",
		note: "Recommendation profile only until the host exposes direct compaction.",
	},
	{
		id: "standard",
		label: "Standard",
		note: "Recommendation profile only until the host exposes direct compaction.",
	},
	{
		id: "aggressive",
		label: "Aggressive",
		note: "Recommendation profile only until the host exposes direct compaction.",
	},
];

const ADAPTER_COMPACTION_COOLDOWN_MS = 5_000;
const ADAPTER_NEW_SESSION_COOLDOWN_MS = 10_000;

class OpenClawAgentStateSelfRegulationPlugin {
	private readonly config;
	private readonly capabilities;
	private readonly runtimeAgent: OpenClawRuntimeAgentFacade;
	private readonly promptRenderer = new OpenClawPromptRenderer();
	private readonly assessmentEngine = new OpenClawAssessmentEngine();
	private readonly sessionStore = new OpenClawSessionStateStore();
	private readonly scriptProbes: ScriptProbeRunner[];
	private readonly assessmentExtenders: AssessmentExtender[];

	constructor(
		private readonly api: OpenClawPluginApi,
		options: OpenClawAdapterOptions,
	) {
		const pluginConfig = normalizePluginConfig(api.pluginConfig);
		this.config = createAdapterConfig({
			...pluginConfig,
			...options.config,
			thresholds: {
				tightPercent:
					options.config?.thresholds?.tightPercent ??
					pluginConfig.thresholds?.tightPercent ??
					DEFAULT_OPENCLAW_ADAPTER_CONFIG.thresholds.tightPercent,
				criticalPercent:
					options.config?.thresholds?.criticalPercent ??
					pluginConfig.thresholds?.criticalPercent ??
					DEFAULT_OPENCLAW_ADAPTER_CONFIG.thresholds.criticalPercent,
			},
		});
		this.capabilities = detectHostCapabilities(api);
		this.runtimeAgent = new OpenClawRuntimeAgentFacade(api.runtime);
		this.scriptProbes = (options.scriptProbes ?? []).map((probe) => new ScriptProbeRunner(probe));
		this.assessmentExtenders = options.assessmentExtenders ?? [];
	}

	register(): void {
		this.api.logger.info(
			`agent-state-self-regulation adapter loaded (directCompaction=${this.capabilities.directCompaction}, directNewSession=${this.capabilities.directNewSession}, contextWindowUsage=${this.capabilities.contextWindowUsage})`,
		);

		this.api.registerTool(
			createSelfRegulationToolFactory({
				getState: async (ctx, options) => await this.getState(ctx, options),
				listProfiles: () => structuredClone(COMPACTION_PROFILES),
				setThresholds: (ctx, input) => this.setThresholds(ctx, input),
				requestCompaction: (ctx, input) => this.requestCompaction(ctx, input),
				requestNewSession: (ctx, input) => this.requestNewSession(ctx, input),
			}),
		);

		this.api.on("session_start", (_event, ctx) => {
			this.sessionStore.loadFromAgentContext(ctx, this.capabilities, this.config);
		});
		this.api.on("before_compaction", (event, ctx) => {
			const { sessionKey, record } = this.sessionStore.loadFromAgentContext(ctx, this.capabilities, this.config);
			record.lastCompaction = {
				timestamp: Date.now(),
				messageCount: event.messageCount,
				compactingCount: event.compactingCount ?? null,
				tokenCount: event.tokenCount ?? null,
				compactedCount: null,
				...(event.sessionFile ? { sessionFile: event.sessionFile } : {}),
			};
			this.sessionStore.save(sessionKey, record);
		});
		this.api.on("after_compaction", (event, ctx) => {
			const { sessionKey, record } = this.sessionStore.loadFromAgentContext(ctx, this.capabilities, this.config);
			record.lastCompaction = {
				timestamp: Date.now(),
				messageCount: event.messageCount,
				compactingCount: record.lastCompaction?.compactingCount ?? null,
				tokenCount: event.tokenCount ?? null,
				compactedCount: event.compactedCount,
				...(event.sessionFile ? { sessionFile: event.sessionFile } : {}),
			};
			if (record.lastRequest?.kind === "compact" && record.lastRequest.status === "queued") {
				record.lastRequest = {
					...record.lastRequest,
					status: "completed",
				};
			}
			this.sessionStore.save(sessionKey, record);
		});
		this.api.on("before_reset", (event, ctx) => {
			const { sessionKey, record } = this.sessionStore.loadFromAgentContext(ctx, this.capabilities, this.config);
			record.lastReset = {
				timestamp: Date.now(),
				...(event.reason ? { reason: event.reason } : {}),
				...(event.sessionFile ? { sessionFile: event.sessionFile } : {}),
			};
			if (record.lastRequest?.kind === "new_session" && record.lastRequest.status === "queued") {
				record.lastRequest = {
					...record.lastRequest,
					status: "completed",
				};
			}
			record.lastAssessment = undefined;
			record.probeStates = {};
			record.promptData = {};
			this.sessionStore.save(sessionKey, record);
		});
		this.api.on("before_prompt_build", async (event, ctx) => {
			return await this.handleBeforePromptBuild(event.messages.length, ctx);
		});
	}

	private async handleBeforePromptBuild(messageCount: number, ctx: OpenClawPluginHookAgentContext) {
		if (!this.config.enabled) {
			return;
		}

		const { sessionKey, record } = this.sessionStore.loadFromAgentContext(ctx, this.capabilities, this.config);
		const nextRecord = await this.evaluateSessionState(
			sessionKey,
			this.sessionStore.markPromptBuild(record, messageCount),
			ctx.workspaceDir,
			messageCount,
		);
		this.sessionStore.save(sessionKey, nextRecord);

		if (!this.config.injectRuntimeState) {
			return;
		}

		const assessment = nextRecord.lastAssessment;
		if (!assessment) {
			return;
		}

		const rendered = this.promptRenderer.render(assessment, this.config, {
			probeStates: nextRecord.probeStates,
			promptData: nextRecord.promptData,
		});
		if (!rendered) {
			return;
		}

		return {
			prependContext: rendered,
		};
	}

	private async getState(
		ctx: OpenClawPluginToolContext,
		options?: { refresh?: boolean },
	): Promise<SessionStateRecord> {
		const { sessionKey, record } = this.sessionStore.loadFromToolContext(ctx, this.capabilities, this.config);
		if (!options?.refresh) {
			return record;
		}

		const nextRecord = await this.evaluateSessionState(
			sessionKey,
			record,
			ctx.workspaceDir,
			record.lastPromptBuild?.messageCount ?? null,
		);
		this.sessionStore.save(sessionKey, nextRecord);
		return nextRecord;
	}

	private async collectProbeStates(
		record: SessionStateRecord,
		workspaceDir: string | undefined,
	): Promise<Record<string, ProbeResult>> {
		const nextProbeStates = { ...record.probeStates };
		for (const probe of this.scriptProbes) {
			const cached = nextProbeStates[probe.key];
			if (cached && cached.sampledAt + cached.ttlMs > Date.now()) {
				continue;
			}

			nextProbeStates[probe.key] = await probe.collect({ workspaceDir });
		}
		return nextProbeStates;
	}

	private async runAssessmentExtenders(
		baseAssessment: OpenClawAssessment,
		probeStates: Record<string, ProbeResult>,
		record: SessionStateRecord,
	): Promise<{ assessment: OpenClawAssessment; promptData: ExtenderPromptFields }> {
		let assessment = baseAssessment;
		const promptData: ExtenderPromptFields = {};

		for (const extender of this.assessmentExtenders) {
			try {
				const result = await extender.extend({
					assessment: structuredClone(assessment),
					probeStates: structuredClone(probeStates),
					session: structuredClone(record),
					capabilities: structuredClone(this.capabilities),
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
				const message = error instanceof Error ? error.message : String(error);
				assessment = {
					...assessment,
					reasons: [
						...assessment.reasons,
						`Assessment extender "${extender.id}" failed: ${message.slice(0, 160)}`,
					],
					suggestedActions: assessment.suggestedActions.includes("monitor_only")
						? assessment.suggestedActions
						: [...assessment.suggestedActions, "monitor_only"],
				};
			}
		}

		return { assessment, promptData };
	}

	private setThresholds(
		ctx: OpenClawPluginToolContext,
		input: Pick<{ tightPercent?: number; criticalPercent?: number }, "tightPercent" | "criticalPercent">,
	): {
		message: string;
		thresholds: ThresholdConfig;
	} {
		const { sessionKey, record } = this.sessionStore.loadFromToolContext(ctx, this.capabilities, this.config);
		const nextThresholds: ThresholdConfig = {
			version: 1,
			tightPercent: input.tightPercent ?? record.thresholds.tightPercent,
			criticalPercent: input.criticalPercent ?? record.thresholds.criticalPercent,
		};
		const validationError = validateThresholdConfig(nextThresholds);
		if (validationError) {
			return {
				message: `${validationError} Current thresholds remain tight=${record.thresholds.tightPercent}, critical=${record.thresholds.criticalPercent}.`,
				thresholds: record.thresholds,
			};
		}

		const nextRecord = this.sessionStore.updateThresholds(record, nextThresholds);
		this.sessionStore.save(sessionKey, nextRecord);
		return {
			message: `Updated thresholds for this OpenClaw session. tight=${nextThresholds.tightPercent}, critical=${nextThresholds.criticalPercent}.`,
			thresholds: nextThresholds,
		};
	}

	private requestCompaction(
		ctx: OpenClawPluginToolContext,
		input: Pick<SelfRegulationToolInput, "profile" | "reason" | "customInstructions">,
	): string {
		const requestedProfile = normalizeCompactionProfile(input.profile, this.config.defaultProfile);
		if (!this.capabilities.directCompaction) {
			return `OpenClaw does not currently expose a direct compaction runtime seam to plugins. Requested profile="${requestedProfile}"${input.reason ? `, reason="${input.reason}"` : ""}.`;
		}
		const { sessionKey, record } = this.sessionStore.loadFromToolContext(ctx, this.capabilities, this.config);
		const throttledMessage = this.getThrottleMessage(record, "compact", ADAPTER_COMPACTION_COOLDOWN_MS);
		if (throttledMessage) {
			return throttledMessage;
		}

		const accepted = this.runtimeAgent.requestCompaction({
			sessionKey,
			profile: requestedProfile,
			customInstructions: input.customInstructions,
			reason: input.reason,
			onComplete: () => {
				this.markRequestStatus(sessionKey, "completed");
			},
			onError: (error) => {
				this.markRequestStatus(sessionKey, "failed", error);
			},
		});
		if (!accepted) {
			return "OpenClaw did not accept the compaction request because the runtime seam is unavailable.";
		}

		this.markRequestQueued(sessionKey, {
			kind: "compact",
			profile: requestedProfile,
			reason: input.reason,
		});
		return `Queued a compaction request with profile "${requestedProfile}"${input.reason ? ` for reason "${input.reason}"` : ""}.`;
	}

	private requestNewSession(
		ctx: OpenClawPluginToolContext,
		input: Pick<SelfRegulationToolInput, "reason" | "handoffSummary">,
	): string {
		if (!this.config.enableNewSession) {
			return "new_session is disabled in this adapter configuration.";
		}
		if (!this.capabilities.directNewSession) {
			return "OpenClaw does not currently expose a direct fresh-session runtime seam to plugins.";
		}
		const { sessionKey, record } = this.sessionStore.loadFromToolContext(ctx, this.capabilities, this.config);
		const throttledMessage = this.getThrottleMessage(record, "new_session", ADAPTER_NEW_SESSION_COOLDOWN_MS);
		if (throttledMessage) {
			return throttledMessage;
		}

		const handoffSummary = buildHandoffSummary({
			record,
			contextUsage:
				record.lastContextUsage ??
				({
					tokens: null,
					contextWindow: null,
					percent: null,
					source: "unknown",
					sampledAt: Date.now(),
				} satisfies RuntimeContextUsage),
			reason: input.reason,
			explicitSummary: input.handoffSummary,
		});
		const accepted = this.runtimeAgent.requestNewSession({
			sessionKey,
			reason: input.reason,
			handoffSummary,
			onComplete: () => {
				this.markRequestStatus(sessionKey, "completed");
			},
			onError: (error) => {
				this.markRequestStatus(sessionKey, "failed", error);
			},
		});
		if (!accepted) {
			return "OpenClaw did not accept the fresh-session request because the runtime seam is unavailable.";
		}

		this.markRequestQueued(sessionKey, {
			kind: "new_session",
			reason: input.reason,
		});
		return "Queued a fresh-session request with a structured handoff summary.";
	}

	private async evaluateSessionState(
		sessionKey: string,
		record: SessionStateRecord,
		workspaceDir: string | undefined,
		messageCount: number | null,
	): Promise<SessionStateRecord> {
		const probeStates = await this.collectProbeStates(record, workspaceDir);
		const contextUsage = await this.runtimeAgent.getContextUsage({ sessionKey });
		const baseAssessment = this.assessmentEngine.evaluate({
			contextUsage,
			messageCount,
			thresholds: record.thresholds,
			defaultProfile: this.config.defaultProfile,
			capabilities: this.capabilities,
			probeStates,
			lastCompactionTokenCount: record.lastCompaction?.tokenCount ?? null,
			lastCompactedCount: record.lastCompaction?.compactedCount ?? null,
		});
		const { assessment, promptData } = await this.runAssessmentExtenders(baseAssessment, probeStates, record);
		return {
			...record,
			lastAssessment: assessment,
			lastContextUsage: contextUsage,
			probeStates,
			promptData,
		};
	}

	private getThrottleMessage(
		record: SessionStateRecord,
		kind: "compact" | "new_session",
		cooldownMs: number,
	): string | undefined {
		const lastRequest = record.lastRequest;
		if (!lastRequest || lastRequest.kind !== kind) {
			return undefined;
		}

		if (lastRequest.status === "queued") {
			return `A ${kind === "compact" ? "compaction" : "fresh-session"} request is already in flight.`;
		}

		if (Date.now() - lastRequest.requestedAt < cooldownMs) {
			return `The adapter is cooling down before sending another ${kind === "compact" ? "compaction" : "fresh-session"} request.`;
		}

		return undefined;
	}

	private markRequestQueued(
		sessionKey: string,
		input: {
			kind: "compact" | "new_session";
			profile?: CompactionProfileId;
			reason?: string;
		},
	): void {
		const record = this.sessionStore.loadBySessionKey(sessionKey, this.capabilities, this.config);
		this.sessionStore.save(sessionKey, {
			...record,
			lastRequest: {
				kind: input.kind,
				requestedAt: Date.now(),
				status: "queued",
				...(input.profile ? { profile: input.profile } : {}),
				...(input.reason ? { reason: input.reason } : {}),
			},
		});
	}

	private markRequestStatus(sessionKey: string, status: "completed" | "failed", error?: unknown): void {
		const record = this.sessionStore.loadBySessionKey(sessionKey, this.capabilities, this.config);
		if (!record.lastRequest) {
			return;
		}

		this.sessionStore.save(sessionKey, {
			...record,
			lastRequest: {
				...record.lastRequest,
				status,
				...(status === "failed"
					? { error: error instanceof Error ? error.message : String(error) }
					: { error: undefined }),
			},
		});
	}
}

export function createOpenClawAgentStateSelfRegulationPlugin(
	options: OpenClawAdapterOptions = {},
): OpenClawPluginDefinition {
	return {
		id: "agent-state-self-regulation",
		name: "Agent State Self Regulation",
		description: "OpenClaw-native adapter for runtime state assessment and host-aware session regulation.",
		register(api: OpenClawPluginApi) {
			new OpenClawAgentStateSelfRegulationPlugin(api, options).register();
		},
	};
}

export type {
	AssessmentExtender,
	AssessmentExtenderContext,
	AssessmentExtenderResult,
	CompactionProfileId,
	ExtenderPromptFields,
	HostCapabilities,
	OpenClawAdapterConfig,
	OpenClawAdapterOptions,
	OpenClawAssessment,
	OpenClawPluginApi,
	OpenClawPluginDefinition,
	PromptFieldMap,
	PromptScalar,
	ScriptProbeDefinition,
	SelfRegulationToolDetails,
	SelfRegulationToolInput,
	SessionStateRecord,
	ThresholdConfig,
} from "./types.js";

export default createOpenClawAgentStateSelfRegulationPlugin();

function normalizeCompactionProfile(profile: string | undefined, fallback: CompactionProfileId): CompactionProfileId {
	return profile === "host-default" || profile === "light" || profile === "standard" || profile === "aggressive"
		? profile
		: fallback;
}
