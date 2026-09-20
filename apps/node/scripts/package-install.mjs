import { api } from '@electron-forge/core';
import path from 'node:path';
import process from 'node:process';

// Installed application is never the build output; a failed package keeps it intact.
const appRoot = path.resolve(import.meta.dirname, '..');
process.chdir(appRoot);
await api.package({ dir: appRoot, outDir: path.join(appRoot, 'out/install-build') });
