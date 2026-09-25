import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const root = process.cwd();
const output = await mkdtemp(join(tmpdir(), 'shared-ci-action-check-'));
try {
  const compile = spawnSync(
    process.execPath,
    [
      resolve(root, 'node_modules/typescript/bin/tsc'),
      '-p',
      'tsconfig.action.json',
      '--outDir',
      output,
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (compile.status !== 0) process.exit(compile.status ?? 1);

  const committed = resolve(root, '.github/actions/node-ci/dist');
  const [expectedFiles, actualFiles] = await Promise.all([files(output), files(committed)]);
  const allPaths = new Set([...expectedFiles.keys(), ...actualFiles.keys()]);
  const mismatches = [];
  for (const path of allPaths) {
    const expected = expectedFiles.get(path);
    const actual = actualFiles.get(path);
    if (!expected || !actual || !expected.equals(actual)) mismatches.push(path);
  }
  if (mismatches.length) {
    console.error(
      `Committed action bundle is out of date. Run npm run build:action.\n${mismatches.join('\n')}`,
    );
    process.exitCode = 1;
  } else {
    console.log('Committed action bundle matches TypeScript sources.');
  }
} finally {
  await rm(output, { recursive: true, force: true });
}

async function files(directory) {
  const result = new Map();
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile()) result.set(relative(directory, fullPath), await readFile(fullPath));
    }
  }
  await visit(directory);
  return result;
}
