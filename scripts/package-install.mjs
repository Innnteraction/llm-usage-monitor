import { api } from '@electron-forge/core';
import path from 'node:path';
import process from 'node:process';

// Installed application is never the build output; a failed package keeps it intact.
await api.package({ dir: process.cwd(), outDir: path.resolve('out/install-build') });
