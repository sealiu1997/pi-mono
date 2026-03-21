import { createThresholdConfig } from "./config.js";
import type {
	HostCapabilities,
	OpenClawAdapterConfig,
	OpenClawPluginHookAgentContext,
	OpenClawPluginToolContext,
	SessionStateRecord,
	ThresholdConfig,
} from "./types.js";

export class OpenClawSessionStateStore {
	private readonly records = new Map<string, SessionStateRecord>();

	loadFromAgentContext(
		ctx: OpenClawPluginHookAgentContext,
		capabilities: HostCapabilities,
		config: OpenClawAdapterConfig,
	): { sessionKey: string; record: SessionStateRecord } {
		const sessionKey = this.resolveAgentSessionKey(ctx);
		return {
			sessionKey,
			record: this.load(sessionKey, capabilities, config),
		};
	}

	loadFromToolContext(
		ctx: OpenClawPluginToolContext,
		capabilities: HostCapabilities,
		config: OpenClawAdapterConfig,
	): { sessionKey: string; record: SessionStateRecord } {
		const sessionKey = this.resolveToolSessionKey(ctx);
		return {
			sessionKey,
			record: this.load(sessionKey, capabilities, config),
		};
	}

	loadBySessionKey(
		sessionKey: string,
		capabilities: HostCapabilities,
		config: OpenClawAdapterConfig,
	): SessionStateRecord {
		return this.load(sessionKey, capabilities, config);
	}

	save(sessionKey: string, record: SessionStateRecord): SessionStateRecord {
		this.records.set(sessionKey, structuredClone(record));
		return record;
	}

	updateThresholds(record: SessionStateRecord, thresholds: ThresholdConfig): SessionStateRecord {
		return {
			...record,
			thresholds: structuredClone(thresholds),
		};
	}

	markPromptBuild(record: SessionStateRecord, messageCount: number): SessionStateRecord {
		return {
			...record,
			lastPromptBuild: {
				timestamp: Date.now(),
				messageCount,
			},
		};
	}

	resolveToolSessionKey(ctx: OpenClawPluginToolContext): string {
		return ctx.sessionKey ?? ctx.sessionId ?? ctx.agentId ?? "openclaw-global";
	}

	private resolveAgentSessionKey(ctx: OpenClawPluginHookAgentContext): string {
		return ctx.sessionKey ?? ctx.sessionId ?? ctx.agentId ?? "openclaw-global";
	}

	private load(sessionKey: string, capabilities: HostCapabilities, config: OpenClawAdapterConfig): SessionStateRecord {
		const existing = this.records.get(sessionKey);
		if (existing) {
			return structuredClone(existing);
		}

		return {
			version: 1,
			thresholds: createThresholdConfig(config),
			capabilities: structuredClone(capabilities),
			probeStates: {},
			promptData: {},
		};
	}
}
