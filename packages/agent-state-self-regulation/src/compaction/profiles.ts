import type { CompactionProfileDefinition } from "../types.js";

export function createDefaultCompactionProfiles(): CompactionProfileDefinition[] {
	return [
		{
			id: "host-default",
			label: "Host Default",
			mode: "delegate",
		},
		{
			id: "light",
			label: "Light",
			mode: "instructions",
			customInstructions:
				"Compact lightly. Preserve the current task, current constraints, and active file context. Compress only peripheral history.",
		},
		{
			id: "standard",
			label: "Standard",
			mode: "instructions",
			customInstructions:
				"Compact the conversation into a concise checkpoint that preserves task intent, recent decisions, blockers, and next steps.",
		},
		{
			id: "aggressive",
			label: "Aggressive",
			mode: "instructions",
			customInstructions:
				"Compact aggressively. Preserve only the essential task state, critical constraints, and the minimum next-step context.",
		},
	];
}

export class CompactionProfileRegistry {
	private readonly profiles = new Map<string, CompactionProfileDefinition>();

	constructor(initialProfiles: CompactionProfileDefinition[] = []) {
		for (const profile of initialProfiles) {
			this.register(profile);
		}
	}

	register(profile: CompactionProfileDefinition): void {
		this.profiles.set(profile.id, profile);
	}

	list(): CompactionProfileDefinition[] {
		return [...this.profiles.values()];
	}

	resolve(id: string): CompactionProfileDefinition | undefined {
		return this.profiles.get(id);
	}
}
