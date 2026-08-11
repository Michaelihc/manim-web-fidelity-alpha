import { spawnSync } from 'node:child_process';

const pattern = '(//|/\\*|\\*|<!--|\\{/\\*|#)[[:space:]]*eslint-(disable|enable)';
const result = spawnSync('git', ['grep', '-nIE', pattern, '--', '.'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
});

if (result.status === 0) {
  process.stderr.write(
    "Found banned 'eslint-disable'/'eslint-enable' directive(s):\n\n" + result.stdout,
  );
  process.exitCode = 1;
} else if (result.status === 1) {
  process.stdout.write("No 'eslint-disable' directives found.\n");
} else {
  process.stderr.write(result.stderr || 'Unable to scan the repository.\n');
  process.exitCode = result.status ?? 1;
}
