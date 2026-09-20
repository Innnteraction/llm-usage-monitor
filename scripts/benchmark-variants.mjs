// Synthetic only. Electron must render successfully before either number is compared.
import { _electron as electron } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const output = path.resolve('.work/parity-captures/install-memory');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'llm-install-memory-'));
const report = { workload: 'same synthetic snapshot, visible expanded view, 5s warmup, 5 samples; Windows process-tree working set sum includes shared pages', results: [] };
const delay = ms => new Promise(resolve => globalThis.setTimeout(resolve, ms));
async function samples(pid) {
  await delay(5000);
  const values = [];
  for (let i = 0; i < 5; i++) {
    const script = `$all=Get-CimInstance Win32_Process; $ids=@(${pid}); do { $next=@($all | Where-Object { $_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids } | ForEach-Object ProcessId); $ids+=$next } while ($next.Count); $sum=(Get-Process -Id $ids -ErrorAction Stop | Measure-Object WorkingSet64 -Sum).Sum; [math]::Round($sum/1MB,2)`;
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    values.push(Number(stdout.trim()));
    await delay(1000);
  }
  return values;
}
let app;
let native;
try {
  app = await electron.launch({
    executablePath: path.resolve('out/install-build/LLM Usage Monitor-win32-x64/LLM Usage Monitor.exe'),
    chromiumSandbox: true, timeout: 20000,
    env: { ...process.env, LLM_USAGE_MONITOR_E2E: '1', LLM_USAGE_MONITOR_E2E_ANTIGRAVITY: '1', LLM_USAGE_MONITOR_E2E_KEEP_VISIBLE: '1', LLM_USAGE_MONITOR_E2E_USER_DATA: profile },
  });
  const page = await app.firstWindow({ timeout: 15000 });
  await page.getByRole('heading', { name: 'Codex', exact: true }).waitFor({ timeout: 15000 });
  // The canonical parity fixture contains fictional accounts only.
  const { readFile } = await import('node:fs/promises');
  const fixture = JSON.parse(await readFile('shared/fixtures/snapshot.json', 'utf8'));
  await page.clock.install({ fixedTime: new Date(fixture.updatedAt) });
  await app.evaluate(({ BrowserWindow }, value) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('usage-monitor:state-changed', value); }, fixture);
  report.results.push({ variant: 'node', workingSetMiB: await samples(app.process().pid) });
  await app.close(); app = undefined;
  native = spawn(path.resolve('target/release/llm-usage-monitor.exe'), [`--demo-snapshot=${path.resolve('shared/fixtures/snapshot.json')}`, '--startup-timing', '--quit-after=25'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let diagnostics = '';
  native.stderr.on('data', chunk => { diagnostics += chunk; });
  const exited = new Promise((resolve, reject) => { native.once('error', reject); native.once('close', resolve); });
  const nativeSamples = await samples(native.pid);
  const code = await exited;
  if (code !== 0 || !diagnostics.includes('first-render')) throw new Error('Native first-render/clean exit was not confirmed');
  report.results.push({ variant: 'rust', workingSetMiB: nativeSamples, firstRenderConfirmed: true });
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => undefined);
  if (native && native.exitCode === null) native.kill();
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
}
globalThis.console.log(JSON.stringify(report));
