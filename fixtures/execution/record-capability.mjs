import { appendFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const [name] = process.argv.slice(2);
await appendFile(process.env.CORE_CAPABILITY_LOG, `${name}\n`);
if (process.env.CORE_CAPABILITY_CWD_LOG)
  await appendFile(process.env.CORE_CAPABILITY_CWD_LOG, `${process.cwd()}\n`);
if (process.env.CORE_CAPABILITY_TIMEOUT === name) await delay(5000);
if ((process.env.CORE_CAPABILITY_FAILURES ?? '').split(',').includes(name)) process.exitCode = 29;
