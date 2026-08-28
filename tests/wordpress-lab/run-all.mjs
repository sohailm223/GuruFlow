/**
 * Full real-WordPress validation run.
 *
 *   node run-all.mjs
 *
 * Requires the ScanSite dev server on http://127.0.0.1:3000.
 */
import { boot } from './runtime.mjs';
import { runConnectionTests } from './t-connection.mjs';
import { runHookTests } from './t-hooks.mjs';
import { runUpgraderTests } from './t-upgrader.mjs';
import { runCollectorTests } from './t-collector.mjs';
import { runScenario } from './t-scenario.mjs';
import { summary, saveResults, phpRun, results } from './harness.mjs';
import { readFileSync } from 'node:fs';

const php = await boot();

// Record the real environment the matrix was produced under, rather than
// asserting it from memory.
const wasm = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const env = await phpRun(php, `
lab_dump('env', array(
  'wordpress'    => get_bloginfo( 'version' ),
  'php'          => PHP_VERSION,
  'phpSapi'      => PHP_SAPI,
  'dbVersion'    => $GLOBALS['wpdb']->db_version(),
  'dbClass'      => get_class( $GLOBALS['wpdb'] ),
  'collector'    => defined( 'SCANSITE_BB_VERSION' ) ? SCANSITE_BB_VERSION : 'unknown',
  'phpWasm'      => '${wasm.dependencies?.['@php-wasm/node'] ?? wasm.devDependencies?.['@php-wasm/node'] ?? 'unknown'}',
) );`);
results.environment = env.markers.env;
console.log(`\nEnvironment: WordPress ${env.markers.env.wordpress} · PHP ${env.markers.env.php} (${env.markers.env.phpSapi}) · ${env.markers.env.dbClass} · collector ${env.markers.env.collector}`);
const siteId = await runConnectionTests(php);
await runHookTests(php);
await runUpgraderTests(php);
await runCollectorTests(php, siteId);
await runScenario(php, siteId);
summary();
saveResults('results.json');
process.exit(0);
