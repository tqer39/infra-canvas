import type { RepositorySnapshot } from './contract.js';
import { analyzeRepository } from './repository-analysis.js';
export function repositoryRelationships(snapshot: RepositorySnapshot): {
  deployment: string[];
  turso: string[];
  secrets: string[];
  workerSecrets: string[];
} {
  const analysis = snapshot.analysis ?? analyzeRepository(snapshot);
  const sources = (kind: string) => [
    ...new Set(
      analysis.relations
        .filter((relation) => relation.kind === kind)
        .flatMap((relation) => relation.evidence.map((evidence) => evidence.file)),
    ),
  ];
  return {
    deployment: sources('deployment'),
    turso: sources('database'),
    secrets: sources('secrets'),
    workerSecrets: sources('secretSync'),
  };
}
