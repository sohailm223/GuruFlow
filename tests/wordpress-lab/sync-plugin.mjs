/**
 * Re-copy the collector plugin from the repository into the lab so tests always
 * exercise current source. Cheap — no PHP boot.
 */
import { cpSync, rmSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const LAB = dirname(fileURLToPath(import.meta.url));
const SRC = join(LAB, '..', '..', 'wordpress-plugin', 'scansite-blackbox-collector');
const DST = join(LAB, 'wp', 'wp-content', 'plugins', 'scansite-blackbox-collector');

rmSync(DST, { recursive: true, force: true });
cpSync(SRC, DST, { recursive: true });
console.log(`plugin synced -> ${DST}`);
console.log(`  files: ${readdirSync(join(DST, 'includes')).length + 1}`);
