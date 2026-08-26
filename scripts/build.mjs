import { access, cp, mkdir, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const dist = path.join(root, 'dist');
const required = ['index.html', 'favicon.svg', 'src/main.js', 'src/webmcp.js', 'src/styles.css'];
for (const file of required) await access(path.join(root, file), constants.R_OK);

const html = await readFile(path.join(root, 'index.html'), 'utf8');
const main = await readFile(path.join(root, 'src/main.js'), 'utf8');
const webmcp = await readFile(path.join(root, 'src/webmcp.js'), 'utf8');
for (const marker of ['Execute Live Enforcement Flow', 'Agent Telemetry Stream', 'authorizationModal', 'receiptCard']) {
  if (!html.includes(marker)) throw new Error(`Missing production UX marker: ${marker}`);
}
for (const tool of ['fetch_contract_clause', 'compute_statutory_penalty', 'generate_enforceable_demand_notice', 'file_dispute_record']) {
  if (!webmcp.includes(`name: '${tool}'`)) throw new Error(`Missing required WebMCP tool: ${tool}`);
}
if (!webmcp.includes('document.modelContext') || !webmcp.includes('navigator.modelContext') || !webmcp.includes('window.__webmcp')) {
  throw new Error('WebMCP canonical registration and compatibility bridge are incomplete.');
}
if (!webmcp.includes('crypto.subtle.digest') || !main.includes('application/pdf')) {
  throw new Error('Cryptographic receipt or downloadable PDF pipeline is missing.');
}
if (!main.includes('breach_delay_days') || !webmcp.includes('breach_delay_days: 32')) {
  throw new Error('Breach-delay calculation is not wired consistently through the production flow.');
}

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'src'), { recursive: true });
await cp(path.join(root, 'index.html'), path.join(dist, 'index.html'));
await cp(path.join(root, 'favicon.svg'), path.join(dist, 'favicon.svg'));
for (const file of ['main.js', 'webmcp.js', 'styles.css']) {
  await cp(path.join(root, 'src', file), path.join(dist, 'src', file));
}
console.log(`Production build complete: ${dist}`);
