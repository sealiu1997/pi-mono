import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { ScriptProbe } from "../src/probes/script-probe.js";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map(async (directory) => {
			await rm(directory, { recursive: true, force: true });
		}),
	);
});

describe("ScriptProbe", () => {
	it("sanitizes structured prompt fields from JSON output", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-self-regulation-"));
		tempDirs.push(directory);
		const scriptPath = join(directory, "probe.mjs");

		await writeFile(
			scriptPath,
			[
				"process.stdout.write(JSON.stringify({",
				'  status: "tight",',
				'  reason: "workspace\\nhealthy",',
				"  data: { queueDepth: 3 },",
				"  promptData: {",
				'    "queue depth": 3,',
				'    "workspace mode": " focused\\u0007 mode ",',
				"    nested: { ignored: true }",
				"  }",
				"}));",
			].join("\n"),
		);

		const probe = new ScriptProbe({
			key: "workspace_health",
			command: process.execPath,
			args: [scriptPath],
			timeoutMs: 500,
		});

		const result = await probe.collect({
			cwd: directory,
		} as unknown as ExtensionContext);

		expect(result.status).toBe("tight");
		expect(result.reason).toBe("workspace healthy");
		expect(result.promptData).toEqual({
			queue_depth: 3,
			workspace_mode: "focused mode",
		});
	});

	it("returns an unknown status when the script times out", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-self-regulation-"));
		tempDirs.push(directory);
		const scriptPath = join(directory, "slow-probe.mjs");

		await writeFile(scriptPath, 'setTimeout(() => process.stdout.write("{}"), 1000);');

		const probe = new ScriptProbe({
			key: "slow_probe",
			command: process.execPath,
			args: [scriptPath],
			timeoutMs: 50,
		});

		const result = await probe.collect({
			cwd: directory,
		} as unknown as ExtensionContext);

		expect(result.status).toBe("unknown");
		expect(result.reason).toContain("timed out");
	});
});
