type OllamaMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
};

type OllamaResponse = {
  message: { content: string };
};

export class OllamaProvider {
  private baseUrl: string;
  private model: string;

  constructor(baseUrl?: string, model?: string) {
    this.baseUrl = baseUrl ?? 'http://localhost:11434';
    this.model = model ?? 'llama3.2-vision';
  }

  async callWithJson(options: {
    system: string;
    userText: string;
    image?: Buffer;
  }): Promise<unknown> {
    const messages: OllamaMessage[] = [
      { role: 'system', content: options.system },
    ];

    const userMsg: OllamaMessage = {
      role: 'user',
      content: options.userText,
    };

    if (options.image) {
      userMsg.images = [options.image.toString('base64')];
    }

    messages.push(userMsg);

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        format: 'json',
        stream: false,
        options: { temperature: 0, num_ctx: 8192 },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama request failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as OllamaResponse;
    const content = data.message.content.trim();

    try {
      return JSON.parse(content);
    } catch {
      const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) return JSON.parse(match[1].trim());
      throw new Error(`Failed to parse JSON from Ollama: ${content.slice(0, 200)}`);
    }
  }
}
