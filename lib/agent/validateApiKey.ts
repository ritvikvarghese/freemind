"use client";

import Anthropic, { AuthenticationError, APIError } from "@anthropic-ai/sdk";

/**
 * Validate a pasted Anthropic key by making one cheap authenticated call
 * (models.list) directly from the browser. The key goes only to Anthropic.
 * Shared by the Settings panel and the first-run welcome modal.
 */
export async function validateApiKey(
  key: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    await client.models.list({ limit: 1 });
    return { ok: true };
  } catch (err) {
    if (err instanceof AuthenticationError) {
      return { ok: false, message: "Invalid API key." };
    }
    if (err instanceof APIError) {
      return { ok: false, message: `API error: ${err.status} ${err.message}` };
    }
    if (
      err instanceof Error &&
      err.message.toLowerCase().includes("failed to fetch")
    ) {
      return {
        ok: false,
        message: "Cannot reach api.anthropic.com, check network or firewall.",
      };
    }
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
