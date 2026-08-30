import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_EVENT_KINDS } from '../src/protocol.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const jsFiles = [...walk(join(root, 'src')), ...walk(join(root, 'ui'))].filter(path => path.endsWith('.js'));
for (const file of jsFiles) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('manifest_version must be 3');
if (manifest.version !== '0.4.0') throw new Error(`unexpected extension version: ${manifest.version}`);
if (manifest.homepage_url !== 'https://github.com/ZEMLYANINYA/browser-research-toolkit') throw new Error('homepage_url is missing or unexpected');
if (manifest.externally_connectable) throw new Error('externally_connectable must not be enabled');

for (const script of manifest.content_scripts || []) {
  for (const file of script.js || []) if (!existsSync(join(root, file))) throw new Error(`missing content script: ${file}`);
}
if (!existsSync(join(root, manifest.background?.service_worker || ''))) throw new Error('missing service worker');
if (!existsSync(join(root, manifest.side_panel?.default_path || ''))) throw new Error('missing side panel');

const agentText = readFileSync(join(root, 'src/page-agent.js'), 'utf8');
const emitted = [...new Set([...agentText.matchAll(/emit\(['\"]([^'\"]+)['\"]/g)].map(match => match[1]))].sort();
const declared = [...PAGE_EVENT_KINDS].sort();
if (JSON.stringify(emitted) !== JSON.stringify(declared)) {
  throw new Error(`page event protocol drift\nemitted=${JSON.stringify(emitted)}\ndeclared=${JSON.stringify(declared)}`);
}

const bridgeText = readFileSync(join(root, 'src/content-bridge.js'), 'utf8');
for (const kind of PAGE_EVENT_KINDS) {
  if (!bridgeText.includes(`'${kind}'`)) throw new Error(`bridge allowlist missing page event kind: ${kind}`);
}

console.log(`BRT Extension ${manifest.version}: ${jsFiles.length} JS files syntax-checked; manifest and page-event protocol verified.`);
