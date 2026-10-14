import type { MLCEngineInterface } from '@mlc-ai/web-llm';
import { draftSchema, type ChatMessage } from './contract.js';
export interface GenerationStats {
  inputTokens: number;
  outputTokens: number;
  firstTokenSeconds?: number;
  tokensPerSecond?: number;
}
export const localModels = [
  {
    id: 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC',
    label: 'Qwen Coder 3B（品質優先）',
    contextWindow: 16384,
    outputTokens: 4096,
  },
  {
    id: 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen Coder 1.5B（速度優先・小さな図向け）',
    contextWindow: 8192,
    outputTokens: 2048,
  },
];
export class LocalModel {
  private engine?: MLCEngineInterface;
  private outputTokens = localModels[0].outputTokens;
  static supported(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator && globalThis.isSecureContext;
  }
  async initialize(
    model: string,
    onProgress: (text: string, progress: number) => void,
  ): Promise<void> {
    if (!LocalModel.supported())
      throw new Error('WebGPU対応のChrome/Edgeなどを、HTTPSまたはlocalhostで使用してください。');
    const config = localModels.find((item) => item.id === model);
    if (!config) throw new Error('モデルを選択してください。');
    await this.engine?.unload();
    this.engine = undefined;
    const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
    this.engine = await CreateMLCEngine(
      model,
      { initProgressCallback: (report) => onProgress(report.text, report.progress) },
      { context_window_size: config.contextWindow },
    );
    this.outputTokens = config.outputTokens;
  }
  async complete(
    messages: ChatMessage[],
    onProgress?: (characters: number, stats?: GenerationStats) => void,
  ): Promise<string> {
    if (!this.engine) throw new Error('先にモデルを読み込んでください。');
    const reply = await this.engine.chat.completions.create({
      messages: messages.map((message, index) => ({
        role: index === 0 ? 'system' : message.role,
        content: message.content,
      })),
      temperature: 0.1,
      max_tokens: this.outputTokens,
      stream: true,
      stream_options: { include_usage: true },
      response_format: { type: 'json_object', schema: JSON.stringify(draftSchema) },
    });
    let content = '',
      finishReason: string | null | undefined;
    let reported = 0;
    for await (const chunk of reply) {
      content += chunk.choices[0]?.delta.content ?? '';
      finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
      if ((!reported && content.length) || content.length - reported >= 80 || chunk.usage) {
        const usage = chunk.usage;
        onProgress?.(
          content.length,
          usage
            ? {
                inputTokens: usage.prompt_tokens,
                outputTokens: usage.completion_tokens,
                firstTokenSeconds: usage.extra.time_to_first_token_s,
                tokensPerSecond: usage.extra.decode_tokens_per_s,
              }
            : undefined,
        );
        reported = content.length;
      }
    }
    if (finishReason === 'length')
      throw new Error('生成が出力上限に達しました。依頼や図を小さくして再試行してください。');
    if (finishReason === 'abort') throw new Error('生成を中止しました。');
    if (!content) throw new Error('モデルから応答を取得できませんでした。');
    return content;
  }
  interrupt(): void {
    void Promise.resolve(this.engine?.interruptGenerate()).catch(() => undefined);
  }
  async dispose(): Promise<void> {
    await this.engine?.unload();
    this.engine = undefined;
  }
}
