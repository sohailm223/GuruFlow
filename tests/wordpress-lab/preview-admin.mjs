/**
 * Render the real WordPress admin screen through PHP-WASM and extract the
 * status panel into a standalone HTML file, so the collector UI can be
 * reviewed without a WordPress install.
 *
 *   node preview-admin.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot } from './runtime.mjs';
import { phpRun } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const php = await boot();

const out = await phpRun(php, `
lab_admin_context();
ob_start();
ScanSite_BB_Admin::instance()->render();
lab_dump('html', ob_get_clean());`, { admin: true });

const html = out.markers.html;
if (!html) throw new Error('admin screen rendered empty');

// Pull the namespaced <style> block and the hero element out of the full page.
const style = html.match(/<style>[\s\S]*?<\/style>/);
const hero = extractBlock(html, '<div class="scansite-bb-hero">');
if (!hero) throw new Error('status panel not found in rendered admin screen');

mkdirSync(join(HERE, '.preview'), { recursive: true });
const file = join(HERE, '.preview', 'wordpress-admin-box.html');

const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ScanSite Black Box — WordPress collector status panel</title>
<style>
  /* Mimics the WordPress admin chrome so the panel sits in its real context. */
  body{margin:0;background:#f0f0f1;color:#3c434a;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif;}
  .wrap{max-width:960px;margin:0 auto;padding:24px 20px 60px;}
  h1{font-size:23px;font-weight:400;padding:9px 0;line-height:1.3;color:#1d2327;}
  .note{margin:0 0 22px;font-size:13px;color:#646970;}
</style>
${style ? style[0] : ''}
</head>
<body>
<div class="wrap">
  <h1>ScanSite Black Box</h1>
  <p class="note">Rendered from the real plugin source via PHP-WASM — this is the exact markup WordPress outputs.</p>
  ${hero}
</div>
</body>
</html>
`;

writeFileSync(file, doc);
console.log(`wrote ${file} (${doc.length} bytes)`);
console.log('hero markup bytes:', hero.length);
process.exit(0);

/** Return the element starting at `open` plus its matching close tag. */
function extractBlock(source, open) {
  const start = source.indexOf(open);
  if (start === -1) return null;
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const nextOpen = source.indexOf('<div', i);
    const nextClose = source.indexOf('</div>', i);
    if (nextClose === -1) return null;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + 4;
    } else {
      depth--;
      i = nextClose + 6;
      if (depth === 0) return source.slice(start, i);
    }
  }
  return null;
}
