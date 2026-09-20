import { api } from '@electron-forge/core';
import path from 'node:path';

// Installed application is never the build output; a failed package keeps it intact.
await api.package({ dir: path.resolve(import.meta.dirname, '..'), outDir: path.resolve(import.meta.dirname, '../out/install-build') });
