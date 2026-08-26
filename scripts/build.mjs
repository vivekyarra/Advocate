import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const dist = path.join(root, 'dist');
const required = ['index.html', 'favicon.svg', 'LICENSE', 'README.md', 'src/main.js', 'src/cloud.js', 'src/webmcp.js', 'src/domain.js', 'src/repository.js', 'src/ui.js', 'src/styles.css', 'src/judge-polish.js', 'src/judge-polish.css'];

for (const file of required) await access(path.join(root, file), constants.R_OK);

const filesToScan = ['index.html', 'README.md', 'src/main.js', 'src/cloud.js', 'src/webmcp.js', 'src/domain.js', 'src/ui.js', 'src/styles.css', 'src/judge-polish.js', 'src/judge-polish.css'];
for (const file of filesToScan) {
  const content = await readFile(path.join(root, file), 'utf8');
  if (new RegExp(`\\b${['No', 'Hold'].join('')}\\b`, 'i').test(content)) throw new Error(`Legacy product name found in ${file}`);
}

const webmcp = await readFile(path.join(root, 'src/webmcp.js'), 'utf8');
if (!webmcp.includes('document.modelContext.registerTool')) throw new Error('Missing imperative WebMCP registration call.');
if ((webmcp.match(/name: '/g) || []).length < 10) throw new Error('Expected a non-trivial WebMCP tool surface.');

const html = await readFile(path.join(root, 'index.html'), 'utf8');
for (const id of ['authView','signInForm','signUpForm','demoAccess','appView','profileForm','supportForm','passwordForm','planGrid','confirmDialog']) {
  if (!html.includes(`id=\"${id}\"`)) throw new Error(`Missing product control: ${id}`);
}
const main = await readFile(path.join(root, 'src/main.js'), 'utf8');
if (main.includes('alert(')) throw new Error('Blocking alert UI is not allowed in the production shell.');
if (!main.includes("from './judge-polish.js'")) throw new Error('Judge-ready UX layer is not wired into the product bootstrap.');

const polishJs = await readFile(path.join(root, 'src/judge-polish.js'), 'utf8');
const polishCss = await readFile(path.join(root, 'src/judge-polish.css'), 'utf8');
for (const requiredCapability of ['get_notifications', 'mark_notifications_read', 'Agent-ready', 'notificationButton']) {
  if (!polishJs.includes(requiredCapability)) throw new Error(`Missing judge-ready capability: ${requiredCapability}`);
}
if (!polishCss.includes('.auth-shell { height: 100svh') || !polishCss.includes('.sidebar {')) throw new Error('Single-viewport laptop layout guardrails are missing.');

const baseStylesheet = '  <link rel="stylesheet" href="/src/styles.css">';
const polishStylesheet = '  <link id="advocate-judge-polish-css" rel="stylesheet" href="/src/judge-polish.css">';
if (!html.includes(baseStylesheet)) throw new Error('Base stylesheet link is missing from index.html.');
let builtHtml = html;
if (!builtHtml.includes('id="advocate-judge-polish-css"')) {
  builtHtml = builtHtml.replace(baseStylesheet, `${baseStylesheet}\n${polishStylesheet}`);
}
if (!builtHtml.includes(polishStylesheet)) throw new Error('Judge polish stylesheet must be render-blocking in the production shell.');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'src'), { recursive: true });
await writeFile(path.join(dist, 'index.html'), builtHtml, 'utf8');
await cp(path.join(root, 'favicon.svg'), path.join(dist, 'favicon.svg'));
await cp(path.join(root, 'src'), path.join(dist, 'src'), { recursive: true });
await writeFile(path.join(dist, '_build.txt'), `Advocate static build\nBuilt: ${new Date().toISOString()}\n`, 'utf8');
console.log(`Build complete: ${dist}`);