import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	CONTEXT_USAGE_PROBE_KEY,
	type ContextUsageSample,
	deriveLevelFromPercent,
	type ProbeResult,
	type RegulationConfig,
	type StateProbe,
} from "../types.js";

export class ContextUsageProbe implements StateProbe<ContextUsageSample> {
	readonly key = CONTEXT_USAGE_PROBE_KEY;
	readonly ttlMs = 0;

	constructor(private readonly config: RegulationConfig) {}

	collect(ctx: ExtensionContext): ProbeResult<ContextUsageSample> {
		const usage = ctx.getContextUsage();
		const sample: ContextUsageSample = {
			tokens: usage?.tokens ?? null,
			contextWindow: usage?.contextWindow ?? null,
			percent: usage?.percent ?? null,
		};

		return {
			key: this.key,
			sampledAt: Date.now(),
			ttlMs: this.ttlMs,
			status: deriveLevelFromPercent(
				sample.percent,
				this.config.contextThresholds.tightPercent,
				this.config.contextThresholds.criticalPercent,
			),
			data: sample,
			reason: sample.percent === null ? "Context usage is unavailable right now." : undefined,
		};
	}
}
