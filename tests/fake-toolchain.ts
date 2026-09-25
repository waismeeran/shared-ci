import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface FakeToolchain {
  readonly root: string;
  readonly bin: string;
  readonly tools: string;
  readonly env: NodeJS.ProcessEnv;
  readonly logPath: string;
  cleanup(): Promise<void>;
  calls(): Promise<readonly { tool: string; args: string[] }[]>;
}

export async function createFakeToolchain(): Promise<FakeToolchain> {
  const root = await mkdtemp(join(tmpdir(), 'shared-ci-toolchain-'));
  const bin = join(root, 'fake-bin');
  const tools = join(root, 'isolated-tools');
  const logPath = join(root, 'calls.jsonl');
  await mkdir(bin, { recursive: true });
  const npmSource = `#!${process.execPath}
const { appendFileSync, chmodSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_TOOL_LOG, JSON.stringify({tool:'npm',args})+'\\n');
if (args[0] === '--version') { if(process.env.FAKE_NPM_VERSION_EXIT) process.exit(Number(process.env.FAKE_NPM_VERSION_EXIT)); console.log(process.env.FAKE_NPM_VERSION ?? '10.8.2'); process.exit(0); }
if (args[0] === 'config' && args[1] === 'get' && args[2] === 'cache') { console.log(process.env.FAKE_NPM_CACHE_PATH ?? process.env.FAKE_TOOL_ROOT + '/npm-cache'); process.exit(0); }
if (args[0] === 'install' && args.includes('corepack@0.36.0')) {
  if (process.env.FAKE_NPM_COREPACK_EXIT) process.exit(Number(process.env.FAKE_NPM_COREPACK_EXIT));
  if (process.env.FAKE_COREPACK_MISSING === '1') process.exit(0);
  const prefix = args[args.indexOf('--prefix') + 1]; const bin = join(prefix, 'node_modules', '.bin'); mkdirSync(bin,{recursive:true});
  for (const [name, source] of [['corepack',${JSON.stringify(corepackSource())}],['pnpm',${JSON.stringify(managerSource('pnpm'))}],['yarn',${JSON.stringify(managerSource('yarn'))}]]) { const path=join(bin,name); writeFileSync(path,source); chmodSync(path,0o755); }
  process.exit(0);
}
if (args[0] === 'ci') { if (process.env.FAKE_NPM_LOCK_MISMATCH === '1') { console.error('npm ci lockfile mismatch'); process.exit(1); } if (process.env.FAKE_NPM_INSTALL_EXIT) { console.error('fake npm ci error'); process.exit(Number(process.env.FAKE_NPM_INSTALL_EXIT)); } if (process.env.FAKE_NPM_CI_DELAY_MS) { setTimeout(()=>{console.log('fake npm ci complete');process.exit(0)},Number(process.env.FAKE_NPM_CI_DELAY_MS)); } else { console.log('fake npm ci complete'); process.exit(0); } }
else process.exit(64);`;
  await executable(join(bin, 'npm'), npmSource);
  return {
    root,
    bin,
    tools,
    logPath,
    env: {
      PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
      FAKE_TOOL_LOG: logPath,
      FAKE_TOOL_ROOT: root,
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
    async calls() {
      let contents: string;
      try {
        contents = await readFile(logPath, 'utf8');
      } catch {
        return [];
      }
      return contents
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { tool: string; args: string[] });
    },
  };
}

function corepackSource(): string {
  return `#!${process.execPath}
const { appendFileSync } = require('node:fs');
const args=process.argv.slice(2); appendFileSync(process.env.FAKE_TOOL_LOG,JSON.stringify({tool:'corepack',args})+'\\n');
if(args[0]==='--version'){console.log(process.env.FAKE_COREPACK_VERSION??'0.36.0');process.exit(0)}
if(args[0]==='install'&&args.includes('-g')){process.exit(Number(process.env.FAKE_COREPACK_ACTIVATION_EXIT??0))}
process.exit(65);`;
}
function managerSource(name: 'pnpm' | 'yarn'): string {
  return `#!${process.execPath}
const { appendFileSync } = require('node:fs');
const args=process.argv.slice(2); appendFileSync(process.env.FAKE_TOOL_LOG,JSON.stringify({tool:'${name}',args})+'\\n');
if(args[0]==='--version'){console.log(process.env.FAKE_${name.toUpperCase()}_VERSION??'${name === 'pnpm' ? '9.15.4' : '4.5.3'}');process.exit(0)}
if(args[0]==='store'&&args[1]==='path'&&'${name}'==='pnpm'){console.log(process.env.FAKE_PNPM_STORE_PATH??process.env.FAKE_TOOL_ROOT+'/pnpm-store');process.exit(0)}
if(args[0]==='config'&&args[1]==='get'&&'${name}'==='yarn'){const key=args[2];if(key==='enableGlobalCache')console.log(process.env.FAKE_YARN_ENABLE_GLOBAL_CACHE??'true');else if(key==='globalFolder')console.log(process.env.FAKE_YARN_GLOBAL_FOLDER??process.env.FAKE_TOOL_ROOT+'/yarn-global');else if(key==='cacheFolder')console.log(process.env.FAKE_YARN_CACHE_FOLDER??'.yarn/cache');else process.exit(67);process.exit(0)}
if(args[0]==='install'){process.exit(Number(process.env.FAKE_${name.toUpperCase()}_INSTALL_EXIT??0))}
process.exit(66);`;
}
async function executable(path: string, source: string): Promise<void> {
  await writeFile(path, source, 'utf8');
  await chmod(path, 0o755);
}
