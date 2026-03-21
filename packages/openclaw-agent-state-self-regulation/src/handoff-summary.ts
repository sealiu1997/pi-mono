import type { RuntimeContextUsage, SessionStateRecord } from "./types.js";

export function buildHandoffSummary(params: {
	record: SessionStateRecord;
	contextUsage: RuntimeContextUsage;
	reason?: string;
	explicitSummary?: string;
}): string {
	if (params.explicitSummary && params.explicitSummary.trim().length > 0) {
		return params.explicitSummary.trim();
	}

	const assessment = params.record.lastAssessment;
	const probeLines = Object.entries(params.record.probeStates)
		.sort(([left], [right]) => left.localeCompare(right))
		.filter(([, probe]) => probe.status !== "normal")
		.map(([key, probe]) => `- ${key}: ${probe.status}${probe.reason ? ` (${probe.reason})` : ""}`);

	const lines = [
		"## Goal",
		"Continue the current task after a fresh-session transition.",
		"",
		"## Trigger",
		params.reason ?? "self-regulation/context-rebirth",
		"",
		"## Context Usage",
		`- percent: ${formatNullableNumber(params.contextUsage.percent, 1)}`,
		`- tokens: ${formatNullableNumber(params.contextUsage.tokens)}`,
		`- contextWindow: ${formatNullableNumber(params.contextUsage.contextWindow)}`,
		`- source: ${params.contextUsage.source}`,
		"",
		"## Current Regulation State",
		`- level: ${assessment?.level ?? "unknown"}`,
		`- recommendedProfile: ${assessment?.selectedProfile ?? "none"}`,
		`- suggestedActions: ${assessment?.suggestedActions.join(", ") ?? "none"}`,
		"",
		"## Reasons",
		...(assessment?.reasons.length ? assessment.reasons.map((reason) => `- ${reason}`) : ["- none recorded"]),
		"",
		"## Recent Session Facts",
		`- lastMessageCount: ${params.record.lastPromptBuild?.messageCount ?? "unknown"}`,
		`- lastCompactionTokenCount: ${formatNullableNumber(params.record.lastCompaction?.tokenCount)}`,
		`- lastCompactedCount: ${formatNullableNumber(params.record.lastCompaction?.compactedCount)}`,
		"",
		"## Probe Signals",
		...(probeLines.length > 0 ? probeLines : ["- none"]),
		"",
		"## Next",
		"1. Resume the current task from this handoff.",
		"2. Preserve the current goal, recent progress, and exact file paths.",
		"3. Re-evaluate context pressure before requesting further cleanup.",
	];

	return lines.join("\n");
}

function formatNullableNumber(value: number | null | undefined, digits?: number): string {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return "unknown";
	}

	return digits !== undefined ? value.toFixed(digits) : String(value);
}
