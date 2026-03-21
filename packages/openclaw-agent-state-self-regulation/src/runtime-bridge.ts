import type {
	GetContextUsageOptions,
	HostCapabilities,
	OpenClawPluginApi,
	OpenClawPluginRuntime,
	RuntimeCompactionRequest,
	RuntimeContextUsage,
	RuntimeNewSessionRequest,
} from "./types.js";

const UNKNOWN_CONTEXT_USAGE: RuntimeContextUsage = {
	tokens: null,
	contextWindow: null,
	percent: null,
	source: "unknown",
	sampledAt: 0,
};

export function detectHostCapabilities(api: OpenClawPluginApi): HostCapabilities {
	const agentRuntime = api.runtime?.agent;
	const sessionRuntime = getSessionRuntime(api.runtime);

	return {
		contextWindowUsage: typeof agentRuntime?.getContextUsage === "function",
		promptInjection: true,
		compactionObservation: true,
		resetObservation: true,
		directCompaction: typeof agentRuntime?.requestCompaction === "function",
		directNewSession: typeof agentRuntime?.requestNewSession === "function",
		scriptProbes: true,
		assessmentExtenders: true,
		sessionPersistence: Boolean(sessionRuntime?.loadSessionStore && sessionRuntime?.saveSessionStore),
	};
}

export class OpenClawRuntimeAgentFacade {
	constructor(private readonly runtime: OpenClawPluginRuntime | undefined) {}

	async getContextUsage(options?: GetContextUsageOptions): Promise<RuntimeContextUsage> {
		const getContextUsage = this.runtime?.agent?.getContextUsage;
		if (typeof getContextUsage !== "function") {
			return this.createUnknownContextUsage();
		}

		try {
			const usage = await getContextUsage(options);
			return this.normalizeContextUsage(usage);
		} catch {
			return this.createUnknownContextUsage();
		}
	}

	requestCompaction(request?: RuntimeCompactionRequest): boolean {
		const requestCompaction = this.runtime?.agent?.requestCompaction;
		if (typeof requestCompaction !== "function") {
			return false;
		}

		requestCompaction(request);
		return true;
	}

	requestNewSession(request?: RuntimeNewSessionRequest): boolean {
		const requestNewSession = this.runtime?.agent?.requestNewSession;
		if (typeof requestNewSession !== "function") {
			return false;
		}

		requestNewSession(request);
		return true;
	}

	private createUnknownContextUsage(): RuntimeContextUsage {
		return {
			...UNKNOWN_CONTEXT_USAGE,
			sampledAt: Date.now(),
		};
	}

	private normalizeContextUsage(usage: RuntimeContextUsage): RuntimeContextUsage {
		return {
			tokens: typeof usage.tokens === "number" && Number.isFinite(usage.tokens) ? usage.tokens : null,
			contextWindow:
				typeof usage.contextWindow === "number" && Number.isFinite(usage.contextWindow)
					? usage.contextWindow
					: null,
			percent: typeof usage.percent === "number" && Number.isFinite(usage.percent) ? usage.percent : null,
			source:
				usage.source === "usage" || usage.source === "estimate" || usage.source === "unknown"
					? usage.source
					: "unknown",
			sampledAt:
				typeof usage.sampledAt === "number" && Number.isFinite(usage.sampledAt) ? usage.sampledAt : Date.now(),
		};
	}
}

function getSessionRuntime(runtime: OpenClawPluginRuntime | undefined) {
	return runtime?.agent?.session;
}
