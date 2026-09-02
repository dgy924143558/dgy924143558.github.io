/*
 * Rebuilds ../vendor/solana.js — the only third-party code the page loads.
 *
 *   npm install && npm run build
 *
 * The page is served as plain static files, so the Solana libraries are
 * bundled ahead of time instead of pulled from a CDN at runtime.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [join(here, 'vendor-entry.js')],
  outfile: join(here, '..', 'vendor', 'solana.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  minify: true,
  legalComments: 'none',
  // web3.js and spl-token expect Node's Buffer as a free global.
  inject: [join(here, 'shim.js')],
  define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' },
});

console.log('vendor/solana.js rebuilt');
