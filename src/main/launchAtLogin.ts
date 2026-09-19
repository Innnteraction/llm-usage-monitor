import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** Only a managed install may register login startup; development copies never steal it. */
export async function launchAtLogin(action: 'query' | 'on' | 'off', executable = process.execPath): Promise<boolean> {
  const windows = process.platform === 'win32';
  const directory = windows ? path.dirname(executable) : path.resolve(path.dirname(executable), '../Resources');
  try {
    const manifest = JSON.parse((await readFile(path.join(directory, 'install-info.json'), 'utf8')).replace(/^\uFEFF/, ''));
    if (manifest.appId !== 'llm-usage-monitor' || manifest.schemaVersion !== 1 || manifest.variant !== 'node' || manifest.executable !== path.basename(executable)) {
      throw new Error('Invalid managed installation');
    }
    await access(path.join(directory, windows ? 'startup.ps1' : 'startup.sh'));
  } catch {
    if (action === 'query') return false;
    throw new Error('Install the app with scripts/install before enabling login startup.');
  }
  const args = windows
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(directory, 'startup.ps1'), '-Action', action, '-Executable', executable]
    : [path.join(directory, 'startup.sh'), action, executable];
  const { stdout } = await execute(windows ? 'powershell.exe' : '/bin/bash', args, { windowsHide: true, timeout: 15_000 });
  const value = stdout.trim();
  if (value !== 'true' && value !== 'false') throw new Error('Invalid login startup response');
  return value === 'true';
}
