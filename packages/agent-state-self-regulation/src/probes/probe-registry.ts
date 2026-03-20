import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	CONTEXT_USAGE_PROBE_KEY,
	type ProbeResult,
	type ResourceSnapshot,
	type StateProbe,
	SYSTEM_MEMORY_PROBE_KEY,
} from "../types.js";

export class ProbeRegistry {
	private readonly probes = new Map<string, StateProbe<unknown>>();
	private readonly cache = new Map<string, ProbeResult>();

	register<T>(probe: StateProbe<T>): void {
		this.probes.set(probe.key, probe as StateProbe<unknown>);
	}

	async collectSnapshot(ctx: ExtensionContext): Promise<ResourceSnapshot> {
		const snapshot: ResourceSnapshot = {
			custom: {},
		};

		for (const probe of this.probes.values()) {
			const result = await this.collectProbeResult(probe, ctx);
			if (probe.key === CONTEXT_USAGE_PROBE_KEY) {
				snapshot.contextUsage = result as ResourceSnapshot["contextUsage"];
				continue;
			}

			if (probe.key === SYSTEM_MEMORY_PROBE_KEY) {
				snapshot.systemMemory = result as ResourceSnapshot["systemMemory"];
				continue;
			}

			snapshot.custom[probe.key] = result;
		}

		return snapshot;
	}

	private async collectProbeResult(probe: StateProbe<unknown>, ctx: ExtensionContext): Promise<ProbeResult> {
		const now = Date.now();
		const cached = this.cache.get(probe.key);
		if (cached && probe.ttlMs > 0 && cached.sampledAt + probe.ttlMs > now) {
			return cached;
		}

		try {
			const result = await probe.collect(ctx);
			this.cache.set(probe.key, result as ProbeResult);
			return result as ProbeResult;
		} catch (error) {
			const failure: ProbeResult = {
				key: probe.key,
				sampledAt: now,
				ttlMs: probe.ttlMs,
				status: "unknown",
				data: {},
				reason: error instanceof Error ? error.message : String(error),
			};
			this.cache.set(probe.key, failure);
			return failure;
		}
	}
}
