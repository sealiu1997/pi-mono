import type { CustomEntry, ExtensionAPI, ExtensionContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import {
	type CustomProbeStates,
	isRegulationStateRecord,
	isRegulationThresholdConfig,
	REGULATION_COMPACTION_ENTRY,
	REGULATION_CONFIG_ENTRY,
	REGULATION_STATE_ENTRY,
	REGULATION_TRANSITION_ENTRY,
	type RegulationStateRecord,
	type RegulationThresholdConfig,
	type StateAssessment,
} from "./types.js";

function isCustomEntry(entry: SessionEntry): entry is CustomEntry {
	return entry.type === "custom";
}

export class RegulationStateStore {
	loadConfig(ctx: ExtensionContext): RegulationThresholdConfig | undefined {
		const entries = ctx.sessionManager.getEntries();
		for (let index = entries.length - 1; index >= 0; index--) {
			const entry = entries[index];
			if (!isCustomEntry(entry)) {
				continue;
			}
			if (entry.customType !== REGULATION_CONFIG_ENTRY) {
				continue;
			}
			if (isRegulationThresholdConfig(entry.data)) {
				return entry.data;
			}
		}
		return undefined;
	}

	load(ctx: ExtensionContext): RegulationStateRecord | undefined {
		const entries = ctx.sessionManager.getEntries();
		for (let index = entries.length - 1; index >= 0; index--) {
			const entry = entries[index];
			if (!isCustomEntry(entry)) {
				continue;
			}
			if (entry.customType !== REGULATION_STATE_ENTRY) {
				continue;
			}
			if (isRegulationStateRecord(entry.data)) {
				return entry.data;
			}
		}
		return undefined;
	}

	saveConfig(
		pi: ExtensionAPI,
		current: RegulationThresholdConfig | undefined,
		next: RegulationThresholdConfig,
	): RegulationThresholdConfig {
		const currentJson = current ? JSON.stringify(current) : undefined;
		const nextJson = JSON.stringify(next);
		if (currentJson === nextJson) {
			return current ?? next;
		}

		pi.appendEntry(REGULATION_CONFIG_ENTRY, next);
		return next;
	}

	updateFromAssessment(
		current: RegulationStateRecord | undefined,
		assessment: StateAssessment,
		customProbeStates: CustomProbeStates,
	): RegulationStateRecord {
		const levelChanged = current?.lastAssessment?.level !== assessment.level;
		return {
			version: 1,
			lastAssessment: assessment,
			lastTransitionAt: levelChanged ? assessment.generatedAt : current?.lastTransitionAt,
			lastProfileUsed: current?.lastProfileUsed,
			customProbeStates: structuredClone(customProbeStates),
		};
	}

	saveIfChanged(
		pi: ExtensionAPI,
		current: RegulationStateRecord | undefined,
		next: RegulationStateRecord,
		persistTransitionsOnly: boolean,
	): RegulationStateRecord {
		const currentJson = current ? this.buildPersistenceFingerprint(current, persistTransitionsOnly) : undefined;
		const nextJson = this.buildPersistenceFingerprint(next, persistTransitionsOnly);
		if (currentJson === nextJson) {
			return current ?? next;
		}

		pi.appendEntry(REGULATION_STATE_ENTRY, next);
		if (current && current.lastAssessment?.level !== next.lastAssessment?.level) {
			pi.appendEntry(REGULATION_TRANSITION_ENTRY, {
				from: current?.lastAssessment?.level ?? "unknown",
				to: next.lastAssessment?.level,
				at: next.lastAssessment?.generatedAt ?? Date.now(),
			});
		}

		return next;
	}

	recordCompactionExecution(
		pi: ExtensionAPI,
		current: RegulationStateRecord | undefined,
		profileId: string,
		reason?: string,
		executedAt: number = Date.now(),
	): RegulationStateRecord {
		const next: RegulationStateRecord = {
			version: 1,
			lastAssessment: current?.lastAssessment,
			lastTransitionAt: current?.lastTransitionAt,
			lastProfileUsed: profileId,
			customProbeStates: current?.customProbeStates,
		};

		pi.appendEntry(REGULATION_COMPACTION_ENTRY, {
			profileId,
			reason,
			executedAt,
		});

		return this.saveIfChanged(pi, current, next, false);
	}

	private buildPersistenceFingerprint(record: RegulationStateRecord, persistTransitionsOnly: boolean): string {
		if (!persistTransitionsOnly) {
			return JSON.stringify(record);
		}

		return JSON.stringify({
			version: record.version,
			level: record.lastAssessment?.level,
			lastTransitionAt: record.lastTransitionAt,
			lastProfileUsed: record.lastProfileUsed,
			customProbeStates: this.buildCustomProbeFingerprint(record.customProbeStates),
		});
	}

	private buildCustomProbeFingerprint(
		customProbeStates: CustomProbeStates | undefined,
	): Record<string, unknown> | undefined {
		if (!customProbeStates) {
			return undefined;
		}

		const entries = Object.entries(customProbeStates).sort(([left], [right]) => left.localeCompare(right));
		return Object.fromEntries(
			entries.map(([key, state]) => [
				key,
				{
					status: state.status,
					reason: state.reason,
				},
			]),
		);
	}
}
