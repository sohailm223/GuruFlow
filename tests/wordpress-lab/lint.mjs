/**
 * PHP syntax validation for the collector plugin.
 *
 * The sandbox has no native `php` binary, so this drives real PHP interpreters
 * compiled to WebAssembly (@php-wasm/node). Two independent checks run per file
 * per PHP version:
 *
 *   1. token_get_all( $src, TOKEN_PARSE )  — PHP's own parser, throws ParseError
 *   2. compiling the file via scriptPath   — every class file guards with
 *      `if ( ! defined( 'ABSPATH' ) ) exit;`, so compiling performs a full-file
 *      syntax check with no side effects
 *
 * A deliberately broken file is linted first as a self-test: if the linter
 * cannot detect that, its "all clean" verdict is meaningless.
 *
 *   node lint.mjs
 */
import { boot } from './runtime.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs';

const LAB = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(LAB, '..', '..', 'wordpress-plugin', 'scansite-blackbox-collector');
const TMP = join(LAB, '.lint-tmp');

const VERSIONS = (process.env.LINT_PHP_VERSIONS || '8.0,8.1,8.2,8.3,8.4').split(',');

mkdirSync(TMP, { recursive: true });
const BAD = join(TMP, 'deliberately-broken.php');
writeFileSync(BAD, `<?php\nclass Broken {\n\tpublic function oops( {\n\t\treturn 1;\n}\n`);

function files(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name), `${prefix}${e.name}/`)
      : e.name.endsWith('.php')
        ? [`${prefix}${e.name}`]
        : []
  );
}

const targets = files(PLUGIN);
console.log(`Found ${targets.length} PHP files under ${PLUGIN}`);

const report = [];
let selfTestPassed = false;

for (const version of VERSIONS) {
  process.stdout.write(`\nPHP ${version}: `);
  const php = await boot(version);

  // Self-test: the broken file MUST be reported as broken.
  const badRes = await php.run({
    code: `<?php
try { token_get_all( file_get_contents( '${BAD}' ), TOKEN_PARSE ); echo 'NO_ERROR'; }
catch ( ParseError $e ) { echo 'PARSE_ERROR: ', $e->getMessage(), ' line ', $e->getLine(); }
`,
  });
  const detected = String(badRes.text || '').startsWith('PARSE_ERROR');
  if (version === VERSIONS[0]) {
    selfTestPassed = detected;
    console.log(`\n  self-test (broken file detected): ${detected ? 'YES' : 'NO'} — ${String(badRes.text).trim().slice(0, 70)}`);
  }
  if (!detected) {
    console.log('  ! linter failed its own self-test on this version; skipping');
    continue;
  }

  for (const rel of targets) {
    const abs = join(PLUGIN, rel);
    const tok = await php.run({
      code: `<?php
try { token_get_all( file_get_contents( '${abs}' ), TOKEN_PARSE ); echo 'OK'; }
catch ( ParseError $e ) { echo 'PARSE_ERROR: ', $e->getMessage(), ' line ', $e->getLine(); }
`,
    });
    const tokenOk = String(tok.text || '').trim() === 'OK';

    let compileOk = true;
    let compileErr = '';
    try {
      const c = await php.run({ scriptPath: abs });
      compileOk = c.exitCode === 0 && !/Fatal error|Parse error|syntax error/i.test(c.errors || '');
      compileErr = (c.errors || '').slice(0, 120);
    } catch (e) {
      compileOk = false;
      compileErr = String(e.message || e).slice(0, 120);
    }

    const ok = tokenOk && compileOk;
    process.stdout.write(ok ? '.' : `F(${rel})`);
    report.push({ version, file: rel, tokenOk, compileOk, ok, detail: tokenOk ? compileErr : String(tok.text).trim() });
  }
  console.log('');
}

rmSync(TMP, { recursive: true, force: true });

const failures = report.filter((r) => !r.ok);
const versionsChecked = [...new Set(report.map((r) => r.version))];

console.log('\n' + '='.repeat(72));
console.log('PHP SYNTAX VALIDATION');
console.log('='.repeat(72));
console.log(`Engine          : real PHP interpreters via @php-wasm/node (WebAssembly)`);
console.log(`Versions checked: ${versionsChecked.join(', ')}`);
console.log(`Files checked   : ${targets.length}`);
console.log(`Checks run      : ${report.length} (${report.length / Math.max(1, versionsChecked.length)} files x ${versionsChecked.length} versions)`);
console.log(`Self-test       : ${selfTestPassed ? 'PASSED — linter detects broken PHP' : 'FAILED'}`);
console.log(`Result          : ${failures.length === 0 ? `ALL CLEAN (${report.length}/${report.length})` : `${failures.length} FAILURES`}`);
for (const f of failures) console.log(`  ✗ PHP ${f.version} ${f.file}: ${f.detail}`);

if (!selfTestPassed || failures.length) process.exit(1);
process.exit(0);
