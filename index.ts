import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "sakana";
const PROVIDER_NAME = "Sakana Fugu";

const DEFAULT_BASE_URL = "https://api.sakana.ai/v1";

function normalizeBaseUrl(value: string | undefined): string {
	const baseUrl = (value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
	return baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
}

function preferredApiKeyReference(): string {
	// Sakana's current getting-started docs use SAKANA_API_KEY. Some examples
	// and early Fugu material use FUGU_API_KEY, so accept that alias when it is
	// already present in the environment at pi startup.
	if (process.env.SAKANA_API_KEY) return "$SAKANA_API_KEY";
	if (process.env.FUGU_API_KEY) return "$FUGU_API_KEY";
	return "$SAKANA_API_KEY";
}

const fuguReasoningLevels = {
	off: null,
	minimal: null,
	low: null,
	medium: null,
	high: "high",
	xhigh: "xhigh",
};

const fuguInput: ("text" | "image")[] = ["text", "image"];

const fuguAgentSafetyInstructions = `Before recommending or running any command that could stop, restart, or replace the environment you are running in — e.g. \`wsl --shutdown\` / \`wsl --terminate\`, host or VM reboot, \`systemctl\`/service restarts of your runtime, or killing your own shell, container, or session processes — first determine whether you are executing inside that same environment. If you might be, do not run it yourself: warn the user explicitly that the command will end this session and your ability to help until it is restarted, give the exact recovery steps, and let the user run it manually when they are ready.

Never force-kill processes by raw PID against arbitrary or unknown PID lists (e.g. \`kill -9\`, \`Stop-Process -Force\`, \`taskkill /F\`): the agent runtime depends on its own child processes, and force-killing them can permanently break the session. To stop a dev server or free a port, stop the owning task by name; otherwise ask the user before terminating any PID.`;

const fuguOverflowPattern =
	/(context(?:_|\s|-)?(?:length|window|limit)|prompt\s+(?:is\s+)?too\s+long|input\s+(?:is\s+)?too\s+large|input\s+.*exceed.*context|maximum\s+context)/i;

async function loginWithSakanaApiKey(
	callbacks: OAuthLoginCallbacks,
	baseUrl: string,
): Promise<OAuthCredentials> {
	callbacks.onAuth({ url: "https://console.sakana.ai/api-keys" });

	const apiKey = (await callbacks.onPrompt({
		message: "Paste your Sakana API key (from https://console.sakana.ai/api-keys):",
	})).trim();

	if (!apiKey) throw new Error("No Sakana API key provided");

	const response = await fetch(`${baseUrl}/models`, {
		headers: { Authorization: `Bearer ${apiKey}` },
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => "");
		throw new Error(`Sakana API key validation failed: ${response.status} ${errorText}`.trim());
	}

	return {
		refresh: apiKey,
		access: apiKey,
		// API keys do not expire through an OAuth refresh flow. Use a long-lived
		// expiry and keep refreshToken idempotent below.
		expires: Date.now() + 3650 * 24 * 60 * 60 * 1000,
	};
}

async function refreshSakanaApiKey(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	return {
		...credentials,
		access: credentials.access || credentials.refresh,
		expires: Date.now() + 3650 * 24 * 60 * 60 * 1000,
	};
}

export default function sakanaFuguConnector(pi: ExtensionAPI) {
	const baseUrl = normalizeBaseUrl(process.env.SAKANA_BASE_URL || process.env.FUGU_BASE_URL);

	pi.registerProvider(PROVIDER_ID, {
		name: PROVIDER_NAME,
		baseUrl,
		apiKey: preferredApiKeyReference(),
		api: "openai-responses",
		oauth: {
			name: "Sakana Fugu (API key)",
			login: (callbacks) => loginWithSakanaApiKey(callbacks, baseUrl),
			refreshToken: refreshSakanaApiKey,
			getApiKey: (credentials) => credentials.access,
		},
		models: [
			{
				id: "fugu",
				name: "Fugu",
				reasoning: true,
				thinkingLevelMap: fuguReasoningLevels,
				input: fuguInput,
				// Fugu routes dynamically and Sakana bills based on the selected
				// underlying model/top tier involved, so pi cannot represent an exact
				// static per-token rate for this model.
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1_000_000,
				maxTokens: 64_000,
			},
			{
				id: "fugu-ultra",
				name: "Fugu Ultra",
				reasoning: true,
				thinkingLevelMap: fuguReasoningLevels,
				input: fuguInput,
				// Standard fugu-ultra public price per 1M tokens. Sakana charges a
				// higher tier for context above 272K; pi model costs cannot express
				// context-dependent pricing, so this is the base rate.
				cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
				contextWindow: 1_000_000,
				maxTokens: 128_000,
			},
			{
				id: "fugu-ultra-20260615",
				name: "Fugu Ultra 2026-06-15",
				reasoning: true,
				thinkingLevelMap: fuguReasoningLevels,
				input: fuguInput,
				cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
				contextWindow: 1_000_000,
				maxTokens: 128_000,
			},
		],
	});

	// Sakana ships these base agent-conduct safeguards with its Codex catalog.
	// Append them only when a Fugu model is selected so other providers are not
	// affected.
	pi.on("before_agent_start", (event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_ID) return;
		return { systemPrompt: `${fuguAgentSafetyInstructions}\n\n${event.systemPrompt}` };
	});

	// Normalize provider-specific context overflow wording so pi's automatic
	// compaction-and-retry path can recognize it.
	pi.on("message_end", (event, ctx) => {
		const message = event.message;
		if (message.role !== "assistant") return;
		if (message.stopReason !== "error") return;
		if (message.provider !== PROVIDER_ID && ctx.model?.provider !== PROVIDER_ID) return;

		const errorMessage = message.errorMessage ?? "";
		if (errorMessage.includes("context_length_exceeded")) return;
		if (!fuguOverflowPattern.test(errorMessage)) return;

		return {
			message: {
				...message,
				errorMessage: `context_length_exceeded: ${errorMessage}`,
			},
		};
	});
}
