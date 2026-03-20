import {
	type CompactionResult,
	type CompactOptions,
	compact,
	type ExtensionContext,
	type SessionBeforeCompactEvent,
} from "@mariozechner/pi-coding-agent";
import type { CompactionProfileDefinition } from "../types.js";

export function buildCompactionInstructions(profile: CompactionProfileDefinition, reason?: string): string | undefined {
	if (profile.mode !== "instructions") {
		return undefined;
	}

	return [profile.customInstructions, reason ? `Reason: ${reason}` : undefined].filter(Boolean).join("\n\n");
}

export function requestCompaction(
	ctx: ExtensionContext,
	profile: CompactionProfileDefinition,
	options?: CompactOptions,
): string {
	ctx.compact(options);

	return `Queued compaction with profile "${profile.id}". The current turn will stop after this tool result is returned.`;
}

export async function runCompactionProfile(
	ctx: ExtensionContext,
	event: SessionBeforeCompactEvent,
	profile: CompactionProfileDefinition,
	reason?: string,
): Promise<CompactionResult | undefined> {
	switch (profile.mode) {
		case "delegate":
			return undefined;
		case "instructions": {
			const model = ctx.model;
			if (!model) {
				throw new Error("No model selected for compaction.");
			}

			const apiKey = await ctx.modelRegistry.getApiKey(model);
			if (!apiKey) {
				throw new Error(`No API key for ${model.provider}.`);
			}

			return await compact(
				event.preparation,
				model,
				apiKey,
				buildCompactionInstructions(profile, reason),
				event.signal,
			);
		}
		case "custom":
			return await profile.execute({
				ctx,
				preparation: event.preparation,
				branchEntries: event.branchEntries,
				reason,
				signal: event.signal,
			});
	}
}
