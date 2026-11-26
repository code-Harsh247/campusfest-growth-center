import Anthropic from "@anthropic-ai/sdk";

/**
 * Where the copilot's model calls go. Either OpenRouter, through its
 * Anthropic-compatible Messages endpoint (the same request shape, so the same
 * SDK and loop), or Anthropic directly. OpenRouter wins when both keys are set.
 * Claude Haiku 5.5 is the default because it is the cheapest; set COPILOT_MODEL
 * to move up to Sonnet or Opus if the test set says Haiku is not good enough.
 */

export type ProviderName = "openrouter" | "anthropic";
type Env = Record<string, string | undefined>;

export interface CopilotSettings {
  provider: ProviderName;
  model: string;
  effort: "low" | "medium" | "high";
  /** Anthropic's server-side retry on another model when a request is declined. Not on OpenRouter or Haiku. */
  serverFallback: boolean;
  /** Extra body fields for OpenRouter: keep Claude on Anthropic's own servers, where every feature we use works. */
  extraBody: Record<string, unknown>;
}

export function providerName(env: Env = process.env): ProviderName | null {
  if (env.OPENROUTER_API_KEY) return "openrouter";
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return "anthropic";
  return null;
}

export function copilotSettings(env: Env = process.env): CopilotSettings {
  const provider = providerName(env) ?? "anthropic";
  const model = env.COPILOT_MODEL || (provider === "openrouter" ? "anthropic/claude-haiku-5.5" : "claude-haiku-5-5");
  const effort = (["low", "medium", "high"].includes(env.COPILOT_EFFORT ?? "") ? env.COPILOT_EFFORT : "medium") as CopilotSettings["effort"];
  return {
    provider,
    model,
    effort,
    serverFallback: provider === "anthropic" && !/haiku/i.test(model),
    extraBody: provider === "openrouter" ? { provider: { order: ["anthropic"], allow_fallbacks: true } } : {},
  };
}

/** The SDK client for the chosen provider. The OpenRouter key goes as a bearer token, as its docs say. */
export function makeClient(env: Env = process.env): Anthropic {
  if (providerName(env) === "openrouter") {
    return new Anthropic({
      baseURL: env.OPENROUTER_BASE_URL || "https://openrouter.ai/api",
      apiKey: null,
      authToken: env.OPENROUTER_API_KEY,
      defaultHeaders: { "X-Title": "Growth Center" },
      maxRetries: 2,
    });
  }
  return new Anthropic({ maxRetries: 2 });
}
