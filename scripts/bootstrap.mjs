import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
      ...opts,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function nowIso() {
  return new Date().toISOString();
}

async function updateRulesRuntimeStatus({ status, timestamp, note }) {
  const rulesPath = path.join(repoRoot, 'RULES.md');
  const rules = await fs.readFile(rulesPath, 'utf8');

  const updated = rules
    .replace(
      /## QA Status[\s\S]*?\n- Timestamp: .*\n- Failures:.*\n/m,
      (block) => {
        const failuresLine = status === 'PASS' ? '- Failures: (none)' : '- Failures: (see last output)';
        return (
          '## QA Status\n' +
          `- Status: ${status}\n` +
          `- Timestamp: ${timestamp}\n` +
          `${failuresLine}\n`
        );
      },
    )
    .replace(
      /## Change Log\n/m,
      `## Change Log\n- ${timestamp}: bootstrap run (${status})${note ? ` — ${note}` : ''}.\n`,
    );

  await fs.writeFile(rulesPath, updated, 'utf8');
}

async function main() {
  const ts = nowIso();
  try {
    await run('npm', ['run', 'setup']);
    await run('npm', ['run', 'qa']);
    await updateRulesRuntimeStatus({ status: 'PASS', timestamp: ts });
  } catch (err) {
    await updateRulesRuntimeStatus({
      status: 'FAIL',
      timestamp: ts,
      note: String(err?.message ?? err),
    }).catch(() => undefined);
    throw err;
  }

  await run('npm', ['run', 'preview']);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
