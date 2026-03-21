import { spawn } from "node:child_process";

import {
	isRegulationLevel,
	type ProbeResult,
	type PromptFieldMap,
	type PromptScalar,
	type RegulationLevel,
	type ScriptProbeContext,
	type ScriptProbeDefinition,
} from "./types.js";

const DEFAULT_SCRIPT_PROBE_TTL_MS = 60_000;
const DEFAULT_SCRIPT_PROBE_TIMEOUT_MS = 500;
const DEFAULT_SCRIPT_PROBE_MAX_OUTPUT_BYTES = 4_096;
const DEFAULT_SCRIPT_PROBE_MAX_PROMPT_FIELDS = 6;
const DEFAULT_SCRIPT_PROBE_MAX_PROMPT_VALUE_LENGTH = 160;

interface ScriptProbeOutputShape {
	status?: RegulationLevel;
	reason?: string;
	data?: Record<string, unknown>;
	promptData?: Record<string, unknown>;
}

interface ScriptExecutionResult {
	stdout: string;
	stderr: string;
	code: number;
	killed: boolean;
	timedOut: boolean;
	overflowed: boolean;
	spawnError?: string;
}

export class ScriptProbeRunner {
	readonly key: string;
	readonly ttlMs: number;

	constructor(private readonly definition: ScriptProbeDefinition) {
		this.key = definition.key;
		this.ttlMs = definition.ttlMs ?? DEFAULT_SCRIPT_PROBE_TTL_MS;
	}

	async collect(context: ScriptProbeContext): Promise<ProbeResult<Record<string, unknown>>> {
		const sampledAt = Date.now();
		const execution = await this.executeScript(context);
		if (execution.spawnError) {
			return this.createFailureResult(sampledAt, `Script probe failed to start: ${execution.spawnError}`);
		}

		if (execution.timedOut) {
			return this.createFailureResult(sampledAt, `Script probe timed out after ${this.getTimeoutMs()}ms.`);
		}

		if (execution.overflowed) {
			return this.createFailureResult(
				sampledAt,
				`Script probe output exceeded ${this.getMaxOutputBytes()} bytes and was discarded.`,
			);
		}

		if (execution.killed && execution.code !== 0) {
			return this.createFailureResult(sampledAt, "Script probe was terminated before producing usable output.");
		}

		if (execution.code !== 0) {
			const stderr = sanitizeText(execution.stderr, DEFAULT_SCRIPT_PROBE_MAX_PROMPT_VALUE_LENGTH);
			return this.createFailureResult(
				sampledAt,
				stderr
					? `Script probe exited with code ${execution.code}: ${stderr}`
					: `Script probe exited with code ${execution.code}.`,
			);
		}

		const rawOutput = execution.stdout.trim();
		if (!rawOutput) {
			return this.createFailureResult(sampledAt, "Script probe produced no JSON output.");
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(rawOutput);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return this.createFailureResult(sampledAt, `Script probe returned invalid JSON: ${message}`);
		}

		if (!isRecord(parsed)) {
			return this.createFailureResult(sampledAt, "Script probe JSON must be an object.");
		}

		const output = parsed as ScriptProbeOutputShape;
		const status = isRegulationLevel(output.status) ? output.status : "normal";
		const reason =
			typeof output.reason === "string"
				? sanitizeText(output.reason, DEFAULT_SCRIPT_PROBE_MAX_PROMPT_VALUE_LENGTH)
				: undefined;
		const data = isRecord(output.data) ? output.data : {};
		const promptData = sanitizePromptData(
			isRecord(output.promptData) ? output.promptData : undefined,
			this.definition.maxPromptFields ?? DEFAULT_SCRIPT_PROBE_MAX_PROMPT_FIELDS,
			this.definition.maxPromptValueLength ?? DEFAULT_SCRIPT_PROBE_MAX_PROMPT_VALUE_LENGTH,
		);

		return {
			key: this.key,
			sampledAt,
			ttlMs: this.ttlMs,
			status,
			data,
			reason,
			promptData,
		};
	}

	private createFailureResult(sampledAt: number, reason: string): ProbeResult<Record<string, unknown>> {
		return {
			key: this.key,
			sampledAt,
			ttlMs: this.ttlMs,
			status: "unknown",
			data: {},
			reason,
		};
	}

	private getTimeoutMs(): number {
		return this.definition.timeoutMs ?? DEFAULT_SCRIPT_PROBE_TIMEOUT_MS;
	}

	private getMaxOutputBytes(): number {
		return this.definition.maxOutputBytes ?? DEFAULT_SCRIPT_PROBE_MAX_OUTPUT_BYTES;
	}

	private async executeScript(context: ScriptProbeContext): Promise<ScriptExecutionResult> {
		return await new Promise((resolve) => {
			const child = spawn(this.definition.command, this.definition.args ?? [], {
				cwd: this.definition.cwd ?? context.workspaceDir ?? process.cwd(),
				env: {
					...process.env,
					...this.definition.env,
				},
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let stdout = "";
			let stderr = "";
			let killed = false;
			let timedOut = false;
			let overflowed = false;
			let resolved = false;
			let timeoutId: NodeJS.Timeout | undefined;

			const resolveOnce = (result: ScriptExecutionResult) => {
				if (resolved) {
					return;
				}

				resolved = true;
				if (timeoutId) {
					clearTimeout(timeoutId);
				}
				resolve(result);
			};

			const killChild = () => {
				if (killed) {
					return;
				}
				killed = true;
				child.kill("SIGTERM");
				setTimeout(() => {
					if (!child.killed) {
						child.kill("SIGKILL");
					}
				}, 1000);
			};

			timeoutId = setTimeout(() => {
				timedOut = true;
				killChild();
			}, this.getTimeoutMs());

			child.stdout?.on("data", (chunk: Buffer | string) => {
				stdout += chunk.toString();
				if (Buffer.byteLength(stdout, "utf8") > this.getMaxOutputBytes()) {
					overflowed = true;
					killChild();
				}
			});

			child.stderr?.on("data", (chunk: Buffer | string) => {
				stderr += chunk.toString();
				if (Buffer.byteLength(stderr, "utf8") > this.getMaxOutputBytes()) {
					stderr = stderr.slice(0, this.getMaxOutputBytes());
				}
			});

			child.on("error", (error) => {
				resolveOnce({
					stdout,
					stderr,
					code: 1,
					killed,
					timedOut,
					overflowed,
					spawnError: error.message,
				});
			});

			child.on("close", (code) => {
				resolveOnce({
					stdout,
					stderr,
					code: code ?? 0,
					killed,
					timedOut,
					overflowed,
				});
			});
		});
	}
}

function sanitizePromptData(
	promptData: Record<string, unknown> | undefined,
	maxFields: number,
	maxValueLength: number,
): PromptFieldMap | undefined {
	if (!promptData) {
		return undefined;
	}

	const entries = Object.entries(promptData)
		.sort(([left], [right]) => left.localeCompare(right))
		.slice(0, maxFields);
	const sanitizedEntries: Array<[string, PromptScalar]> = [];

	for (const [key, value] of entries) {
		const sanitizedKey = sanitizePromptFieldKey(key);
		const sanitizedValue = sanitizePromptScalar(value, maxValueLength);
		if (!sanitizedKey || sanitizedValue === undefined) {
			continue;
		}

		sanitizedEntries.push([sanitizedKey, sanitizedValue]);
	}

	if (sanitizedEntries.length === 0) {
		return undefined;
	}

	return Object.fromEntries(sanitizedEntries);
}

function sanitizePromptFieldKey(value: string): string | undefined {
	const sanitized = value
		.trim()
		.replace(/[^a-zA-Z0-9_.-]/g, "_")
		.slice(0, 64);
	return sanitized.length > 0 ? sanitized : undefined;
}

function sanitizePromptScalar(value: unknown, maxValueLength: number): PromptScalar | undefined {
	switch (typeof value) {
		case "string": {
			const sanitized = sanitizeText(value, maxValueLength);
			return sanitized.length > 0 ? sanitized : undefined;
		}
		case "number":
			return Number.isFinite(value) ? value : undefined;
		case "boolean":
			return value;
		case "object":
			return value === null ? null : undefined;
		default:
			return undefined;
	}
}

function sanitizeText(value: string, maxLength: number): string {
	return value
		.replace(/[\u0000-\u001F\u007F]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
