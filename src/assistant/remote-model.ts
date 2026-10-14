import type { ChatMessage } from './contract.js';
import type { GenerationStats } from './local-model.js';
import type { RemoteProvider, RemoteResult } from './remote-contract.js';

/** The browser sends prompts only; credentials never cross this boundary. */
export class RemoteModel {
  private controller?: AbortController;
  constructor(private provider: RemoteProvider) {}
  async complete(
    messages: ChatMessage[],
    onProgress?: (characters: number, stats?: GenerationStats) => void,
  ): Promise<string> {
    const controller = new AbortController();
    this.controller = controller;
    try {
      const response = await fetch('/api/llm/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: this.provider, messages }),
        signal: controller.signal,
      });
      const value = (await response.json()) as RemoteResult & { error?: string };
      if (!response.ok) throw new Error(value.error ?? 'LLMへの接続に失敗しました。');
      if (typeof value.text !== 'string' || !value.text || value.text.length > 100000)
        throw new Error('LLMの応答が空か、上限を超えています。');
      onProgress?.(
        value.text.length,
        value.inputTokens !== undefined && value.outputTokens !== undefined
          ? {
              inputTokens: value.inputTokens,
              outputTokens: value.outputTokens,
            }
          : undefined,
      );
      return value.text;
    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }
  interrupt(): void {
    this.controller?.abort();
  }
  async dispose(): Promise<void> {
    this.interrupt();
  }
}
