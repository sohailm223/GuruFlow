/**
 * Real-PHP unit tests for the static code scanner (no WordPress needed).
 *
 * Verifies: accurate line numbers, the decode→decompress→execute chain,
 * comment false-positive control, and credential redaction. The scanner only
 * ever analyses text — nothing is executed.
 *
 * Run standalone:  node tests/wordpress-lab/t-scanner.mjs
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { boot, run } from "./runtime.mjs";

const LAB = dirname(fileURLToPath(import.meta.url));
const SCANNER = join(LAB, "..", "..", "wordpress-plugin", "scansite-blackbox-collector", "includes", "class-code-scanner.php");

// base64_decode at line 18, gzinflate at 19, eval at 20; a commented eval() at 2.
const lines = ["<?php", "// eval($noop);  <- commented, must NOT trigger", "$data = $_POST['x'];", '$api_key = "fake-test-key";'];
for (let i = 5; i <= 17; i++) lines.push("");
lines.push("$payload = base64_decode($data);", "$payload = gzinflate($payload);", "eval($payload);", "");
const fixture = lines.join("\n");

const b64 = Buffer.from(fixture, "utf8").toString("base64");

const php = await boot("8.3");
const { text, errors } = await run(
  php,
  `<?php
define('ABSPATH', '/tmp/');
require '${SCANNER}';
$src = base64_decode('${b64}');
$res = ScanSite_BB_Code_Scanner::scan_text($src);
$chain = null; $commentFlagged = false;
foreach ($res['findings'] as $f) {
  if ($f['type'] === 'decode_decompress_execute') $chain = $f;
  if ($f['startLine'] === 2) $commentFlagged = true;
}
$redacted = ScanSite_BB_Code_Scanner::redact('$api_key = "fake-test-key";');
$excerptHasSecret = false; $excerptLines = array();
if ($chain) {
  foreach ($chain['excerpt'] as $ln) {
    $excerptLines[] = $ln['line'];
    if (strpos($ln['text'], 'fake-test-key') !== false) $excerptHasSecret = true;
  }
}
echo json_encode(array(
  'chainStart' => $chain ? $chain['startLine'] : null,
  'chainEnd'   => $chain ? $chain['endLine'] : null,
  'excerptLines' => $excerptLines,
  'excerptHasSecret' => $excerptHasSecret,
  'redacted' => $redacted,
  'commentFlagged' => $commentFlagged,
));
`
);

if (errors) console.error("PHP errors:", errors);
const out = JSON.parse(text.trim().split("\n").pop());

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  ok ? pass++ : fail++;
};

console.log("\nSCANNER (real PHP 8.3)");
check("decode→decompress→execute chain at 18–20", out.chainStart === 18 && out.chainEnd === 20, `lines ${out.chainStart}–${out.chainEnd}`);
check("excerpt covers 18–20 with context", [18, 19, 20].every((l) => out.excerptLines.includes(l)), JSON.stringify(out.excerptLines));
check("commented eval() NOT flagged", out.commentFlagged === false);
check("redact() masks credential", out.redacted.includes("[REDACTED]") && !out.redacted.includes("fake-test-key"), out.redacted);
check("excerpt does not leak credential", out.excerptHasSecret === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
