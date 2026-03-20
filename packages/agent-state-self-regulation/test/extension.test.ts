import type { CompactionResult, ContextEventResult, SessionBeforeCompactEvent } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { createAgentStateSelfRegulationExtension } from "../src/index.js";
import {
	type ProbeResult,
	REGULATION_COMPACTION_ENTRY,
	REGULATION_CONFIG_ENTRY,
	REGULATION_STATE_ENTRY,
	type StateAssessment,
	type StateProbe,
} from "../src/types.js";
import { createMockContext, createMockRuntime } from "./test-helpers.js";

const WORKSPACE_PROBE: StateProbe<{ mode: string }> = {
	key: "workspace",
	ttlMs: 0,
	collect() {
		const result: ProbeResult<{ mode: string }> = {
			key: "workspace",
			sampledAt: Date.now(),
			ttlMs: 0,
			status: "normal",
			data: { mode: "focused" },
			promptData: {
				mode: "focused",
			},
		};

		return result;
	},
};

function getMessageContent(message: NonNullable<ContextEventResult["messages"]>[number] | undefined): string {
	if (!message || !("content" in message) || typeof message.content !== "string") {
		throw new Error("Expected a custom runtime-state message with string content.");
	}

	return message.content;
}

function getToolText(result: { content: Array<{ type: string } | { type: string; text: string }> }): string {
	const firstItem = result.content[0];
	if (!firstItem || !("text" in firstItem)) {
		throw new Error("Expected a text tool result.");
	}

	return firstItem.text;
}

describe("agent-state-self-regulation extension", () => {
	it("registers hooks and injects runtime state with extender prompt data", async () => {
		const runtime = createMockRuntime();
		createAgentStateSelfRegulationExtension({
			customProbes: [WORKSPACE_PROBE],
			assessmentExtenders: [
				{
					id: "workspace_health",
					extend({ assessment }) {
						const nextAssessment: StateAssessment = {
							...assessment,
							level: "critical",
							reasons: [...assessment.reasons, "Workspace health requested aggressive cleanup."],
							suggestedActions: ["compact_standard", "compact_aggressive"],
							selectedProfile: "standard",
						};

						return {
							assessment: nextAssessment,
							promptData: {
								queue_depth: 3,
								workspace_mode: "focused",
							},
						};
					},
				},
			],
		})(runtime.api);

		expect([...runtime.handlers.keys()]).toEqual(
			expect.arrayContaining([
				"session_start",
				"session_switch",
				"session_fork",
				"session_before_compact",
				"session_compact",
				"before_agent_start",
				"context",
			]),
		);
		expect(runtime.tools).toHaveLength(1);

		const { ctx } = createMockContext({
			entries: runtime.entries,
			contextUsage: {
				percent: 42,
				tokens: 420,
				contextWindow: 1_000,
			},
		});

		await runtime.emit("session_start", { type: "session_start" }, ctx);
		const result = await runtime.emit<ContextEventResult>("context", { type: "context", messages: [] }, ctx);
		const injectedMessage = getMessageContent(result?.messages?.at(-1));

		expect(injectedMessage).toContain('<agent_runtime_state level="critical">');
		expect(injectedMessage).toContain("Workspace health requested aggressive cleanup.");
		expect(injectedMessage).toContain('name="workspace.mode"');
		expect(injectedMessage).toContain('name="workspace_health.queue_depth"');
		expect(injectedMessage).toContain("compact_standard, compact_aggressive");
		expect(runtime.entries.some((entry) => entry.customType === REGULATION_STATE_ENTRY)).toBe(true);
	});

	it("supports threshold updates and fresh-session requests through the tool", async () => {
		const runtime = createMockRuntime();
		createAgentStateSelfRegulationExtension({
			config: {
				systemMemoryThresholds: {
					tightPercent: 99.8,
					criticalPercent: 99.9,
				},
			},
		})(runtime.api);

		const tool = runtime.tools[0];
		const { ctx, state } = createMockContext({
			entries: runtime.entries,
			contextUsage: {
				percent: 55,
				tokens: 550,
				contextWindow: 1_000,
			},
			requestNewSessionAvailable: true,
		});

		await runtime.emit("session_start", { type: "session_start" }, ctx);
		const beforeUpdate = await runtime.emit<ContextEventResult>("context", { type: "context", messages: [] }, ctx);
		expect(beforeUpdate).toBeUndefined();

		const updateResult = await tool.execute(
			"tool-1",
			{
				action: "set_thresholds",
				contextTightPercent: 50,
				contextCriticalPercent: 60,
			},
			undefined,
			undefined,
			ctx,
		);

		expect(getToolText(updateResult)).toContain("Updated regulation thresholds.");
		expect(runtime.entries.some((entry) => entry.customType === REGULATION_CONFIG_ENTRY)).toBe(true);

		const afterUpdate = await runtime.emit<ContextEventResult>("context", { type: "context", messages: [] }, ctx);
		expect(getMessageContent(afterUpdate?.messages?.at(-1))).toContain('<agent_runtime_state level="tight">');

		const newSessionResult = await tool.execute("tool-2", { action: "new_session" }, undefined, undefined, ctx);

		expect(getToolText(newSessionResult)).toContain("Queued a fresh session request");
		expect(state.newSessionRequests).toBe(1);
	});

	it("routes custom compaction profiles through session_before_compact", async () => {
		const runtime = createMockRuntime();
		const customCompaction: CompactionResult = {
			summary: "custom compacted summary",
			firstKeptEntryId: "entry-1",
			tokensBefore: 900,
		};

		createAgentStateSelfRegulationExtension({
			customProfiles: [
				{
					id: "custom-test",
					label: "Custom Test",
					mode: "custom",
					execute() {
						return customCompaction;
					},
				},
			],
		})(runtime.api);

		const tool = runtime.tools[0];
		const { ctx, state } = createMockContext({
			entries: runtime.entries,
			contextUsage: {
				percent: 88,
				tokens: 880,
				contextWindow: 1_000,
			},
		});

		await runtime.emit("session_start", { type: "session_start" }, ctx);
		const compactResult = await tool.execute(
			"tool-3",
			{ action: "compact", profile: "custom-test", reason: "Need a stronger checkpoint." },
			undefined,
			undefined,
			ctx,
		);

		expect(getToolText(compactResult)).toContain('Queued compaction with profile "custom-test".');
		expect(state.compactCalls).toHaveLength(1);

		const beforeCompactEvent: SessionBeforeCompactEvent = {
			type: "session_before_compact",
			preparation: {} as SessionBeforeCompactEvent["preparation"],
			branchEntries: [],
			signal: new AbortController().signal,
		};

		const beforeCompactResult = await runtime.emit<{ compaction?: CompactionResult }>(
			"session_before_compact",
			beforeCompactEvent,
			ctx,
		);
		expect(beforeCompactResult?.compaction).toEqual(customCompaction);

		await runtime.emit(
			"session_compact",
			{
				type: "session_compact",
				fromExtension: true,
				compactionEntry: {
					timestamp: new Date("2026-03-19T00:00:00.000Z").toISOString(),
				},
			},
			ctx,
		);

		expect(runtime.entries.some((entry) => entry.customType === REGULATION_COMPACTION_ENTRY)).toBe(true);

		const stateResult = await tool.execute("tool-4", { action: "get_state" }, undefined, undefined, ctx);
		expect(getToolText(stateResult)).toContain("Last executed profile: custom-test");
	});
});
