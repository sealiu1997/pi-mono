import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

const workspaceRoot = resolve(import.meta.dirname, "../..");

export default defineConfig({
	resolve: {
		alias: [
			{
				find: "@mariozechner/pi-coding-agent",
				replacement: resolve(workspaceRoot, "packages/coding-agent/src/index.ts"),
			},
			{
				find: /^@mariozechner\/pi-agent-core\/(.+)$/,
				replacement: resolve(workspaceRoot, "packages/agent/src/$1"),
			},
			{
				find: "@mariozechner/pi-agent-core",
				replacement: resolve(workspaceRoot, "packages/agent/src/index.ts"),
			},
			{
				find: /^@mariozechner\/pi-ai\/(.+)$/,
				replacement: resolve(workspaceRoot, "packages/ai/src/$1"),
			},
			{
				find: "@mariozechner/pi-ai",
				replacement: resolve(workspaceRoot, "packages/ai/src/index.ts"),
			},
			{
				find: /^@mariozechner\/pi-tui\/(.+)$/,
				replacement: resolve(workspaceRoot, "packages/tui/src/$1"),
			},
			{
				find: "@mariozechner/pi-tui",
				replacement: resolve(workspaceRoot, "packages/tui/src/index.ts"),
			},
		],
	},
});
