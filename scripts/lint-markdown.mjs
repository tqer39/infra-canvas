import { lint } from 'markdownlint/promise';
import { readdir } from 'node:fs/promises';
const files = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.github/copilot-instructions.md',
  '.cursor/rules/overview.mdc',
  ...(await readdir('.rulesync/rules', { recursive: true }))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `.rulesync/rules/${f}`),
  ...(await readdir('docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`),
];
const result = await lint({ files, config: { default: true, MD013: false } });
const errors = Object.entries(result).flatMap(([file, problems]) =>
  problems.map(
    (problem) =>
      `${file}:${problem.lineNumber} ${problem.ruleNames.join('/')} ${problem.ruleDescription} ${problem.errorDetail ?? ''}`,
  ),
);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
