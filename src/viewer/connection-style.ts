import type { EdgeKind } from '../core/model';

// 白いキャンバス上の可読性と、色以外の手掛かりを両立する。
export const connectionStyles: Record<EdgeKind, { color: string; dash?: string }> = {
  traffic: { color: '#0072b2' },
  dependency: { color: '#596579', dash: '8 5' },
  auth: { color: '#b65c00', dash: '8 3 2 3' },
  deploy: { color: '#7047b8', dash: '12 4' },
  association: { color: '#008577', dash: '2 4' },
  replication: { color: '#b53683', dash: '10 3 2 3 2 3' },
  failover: { color: '#c83e3e', dash: '4 3' },
};

export const connectionDescriptions: Record<
  EdgeKind,
  { pattern: string; meaning: string; example: string }
> = {
  traffic: {
    pattern: '実線',
    meaning: '送信元から接続先への通信やデータの流れ。',
    example: '例：API → データベースへのクエリ',
  },
  dependency: {
    pattern: '破線',
    meaning: '送信元が接続先のリソースや設定を必要とする関係。通信の成立は示しません。',
    example: '例：サービス → 利用する設定',
  },
  auth: {
    pattern: '一点鎖線',
    meaning: '送信元から接続先への認証・認可に関する関係。実効権限は示しません。',
    example: '例：CI → 引き受けるIAM Role',
  },
  deploy: {
    pattern: '長い破線',
    meaning: '送信元が接続先へアプリや設定を配備・更新する流れ。',
    example: '例：CI/CD → ECSサービス',
  },
  association: {
    pattern: '点線',
    meaning: '所属・関連付け・設定上の関連。通信や依存と区別して表します。',
    example: '例：Security Group → 所属リソース',
  },
  replication: {
    pattern: '二点鎖線',
    meaning: '送信元のデータを接続先へ複製する流れ。',
    example: '例：主データベース → レプリカ',
  },
  failover: {
    pattern: '短い破線',
    meaning: '障害時などに送信元の主系から接続先の待機系へ切り替える関係。',
    example: '例：主系 → 待機系',
  },
};
