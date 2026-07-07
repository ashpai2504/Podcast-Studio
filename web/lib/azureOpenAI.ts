/**
 * Server-only Azure OpenAI client. Reads secrets from process.env - never
 * import this from a client component.
 */
import "server-only";
import type { ChatMessage } from "./scriptPrompt";

function getSettings() {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/+$/, "");
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5-mini";
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2025-04-01-preview";
  if (!endpoint || !apiKey) {
    throw new Error("This tool isn't connected yet - please contact your admin to finish setup.");
  }
  return { endpoint, apiKey, deployment, apiVersion };
}

export async function callAzureChat(messages: ChatMessage[]): Promise<string> {
  const { endpoint, apiKey, deployment, apiVersion } = getSettings();
  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({ messages, response_format: { type: "json_object" } }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Azure OpenAI request failed (${res.status}): ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Azure OpenAI returned no content.");
  return content;
}
