export type LlmMessage = { role: "user" | "assistant" | "system"; content: string };

export interface LlmProvider {
  complete(messages: LlmMessage[]): Promise<string>;
}

export class MockProvider implements LlmProvider {
  constructor(private readonly seed = 0) {}

  async complete(messages: LlmMessage[]): Promise<string> {
    const text = messages.map((m) => m.content).join("\n").toLowerCase();
    if (text.includes("classify")) {
      if (text.includes("bill") || text.includes("charge")) return "billing";
      if (text.includes("login") || text.includes("password")) return "login";
      if (text.includes("ship") || text.includes("delivery")) return "shipping";
      return "general";
    }
    if (text.includes("resolve")) {
      return "We reviewed your account and applied the standard fix for this issue type.";
    }
    return "ack";
  }
}

export class AnthropicProvider implements LlmProvider {
  constructor(private readonly apiKey: string) {}

  async complete(messages: LlmMessage[]): Promise<string> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey });
    const system = messages.find((m) => m.role === "system")?.content;
    const chat = messages.filter((m) => m.role !== "system");
    const response = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 512,
      system,
      messages: chat.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    });
    const block = response.content[0];
    return block?.type === "text" ? block.text : "";
  }
}

export function createLlmProvider(): LlmProvider {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key && key.length > 0) {
    return new AnthropicProvider(key);
  }
  return new MockProvider();
}
