import type { ContextUsage, ExtensionAPI, ExtensionContext, ToolDefinition } from "@mariozechner/pi-coding-agent";

interface StoredCustomEntry {
	type: "custom";
	customType: string;
	data: unknown;
	timestamp: string;
	id: string;
}

type RegisteredHandler = (event: unknown, ctx: ExtensionContext) => unknown | Promise<unknown>;

export interface MockRuntime {
	api: ExtensionAPI;
	handlers: Map<string, RegisteredHandler[]>;
	tools: ToolDefinition[];
	entries: StoredCustomEntry[];
	emit<TResult>(event: string, payload: unknown, ctx: ExtensionContext): Promise<TResult | undefined>;
}

export interface MockContextState {
	compactCalls: unknown[];
	newSessionRequests: number;
}

export function createMockRuntime(): MockRuntime {
	const handlers = new Map<string, RegisteredHandler[]>();
	const tools: ToolDefinition[] = [];
	const entries: StoredCustomEntry[] = [];

	const api = {
		on(event: string, handler: RegisteredHandler) {
			const current = handlers.get(event) ?? [];
			current.push(handler);
			handlers.set(event, current);
		},
		registerTool(tool: ToolDefinition) {
			tools.push(tool);
		},
		appendEntry(customType: string, data?: unknown) {
			entries.push({
				type: "custom",
				customType,
				data,
				timestamp: new Date().toISOString(),
				id: `entry-${entries.length + 1}`,
			});
		},
	} as unknown as ExtensionAPI;

	return {
		api,
		handlers,
		tools,
		entries,
		async emit<TResult>(event: string, payload: unknown, ctx: ExtensionContext) {
			const eventHandlers = handlers.get(event) ?? [];
			let lastResult: TResult | undefined;
			for (const handler of eventHandlers) {
				const result = await handler(payload, ctx);
				if (result !== undefined) {
					lastResult = result as TResult;
				}
			}

			return lastResult;
		},
	};
}

export function createMockContext(options: {
	entries: StoredCustomEntry[];
	contextUsage?: ContextUsage;
	cwd?: string;
	requestNewSessionAvailable?: boolean;
}): { ctx: ExtensionContext; state: MockContextState } {
	const state: MockContextState = {
		compactCalls: [],
		newSessionRequests: 0,
	};

	const context = {
		ui: {},
		hasUI: false,
		cwd: options.cwd ?? process.cwd(),
		sessionManager: {
			getEntries: () => options.entries,
		},
		modelRegistry: {
			getApiKey: async () => "test-api-key",
		},
		model: undefined,
		isIdle: () => true,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => options.contextUsage,
		compact: (compactOptions?: unknown) => {
			state.compactCalls.push(compactOptions);
		},
		requestNewSession: options.requestNewSessionAvailable
			? (requestOptions?: { onComplete?: () => void; onError?: () => void }) => {
					state.newSessionRequests += 1;
					requestOptions?.onComplete?.();
				}
			: undefined,
		getSystemPrompt: () => "System prompt",
	} as unknown as ExtensionContext;

	return { ctx: context, state };
}
