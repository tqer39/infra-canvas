export type RemoteProvider = 'api' | 'bedrock';
export interface ProviderStatus {
  provider: RemoteProvider;
  configured: boolean;
  model: string;
  baseURL?: string;
  hasKey?: boolean;
  profile?: string;
  region?: string;
  settingsSource?: 'persisted' | 'environment';
}
export interface RemoteResult {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}
