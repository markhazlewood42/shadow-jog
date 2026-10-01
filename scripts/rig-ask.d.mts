// Types for scripts/rig-ask.mjs (the animation editor's "Ask Claude", used by vite.config.ts).
export function askClaude(request: unknown): Promise<{ pose: unknown; say: string }>;
