import os from "node:os";

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	deriveLevelFromPercent,
	type ProbeResult,
	type RegulationConfig,
	type StateProbe,
	SYSTEM_MEMORY_PROBE_KEY,
	type SystemMemorySample,
} from "../types.js";

export class SystemMemoryProbe implements StateProbe<SystemMemorySample> {
	readonly key = SYSTEM_MEMORY_PROBE_KEY;
	readonly ttlMs: number;

	constructor(private readonly config: RegulationConfig) {
		this.ttlMs = config.probeTtlMs.systemMemory;
	}

	collect(_ctx: ExtensionContext): ProbeResult<SystemMemorySample> {
		const totalBytes = os.totalmem();
		const freeBytes = os.freemem();
		const usedBytes = Math.max(0, totalBytes - freeBytes);
		const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : null;
		const processUsage = process.memoryUsage();

		const sample: SystemMemorySample = {
			totalBytes,
			freeBytes,
			usedPercent: usedPercent ?? 0,
			processRssBytes: processUsage.rss,
			processHeapUsedBytes: processUsage.heapUsed,
		};

		return {
			key: this.key,
			sampledAt: Date.now(),
			ttlMs: this.ttlMs,
			status: deriveLevelFromPercent(
				usedPercent,
				this.config.systemMemoryThresholds.tightPercent,
				this.config.systemMemoryThresholds.criticalPercent,
			),
			data: sample,
			reason: "Host memory is an advisory-only signal.",
		};
	}
}
