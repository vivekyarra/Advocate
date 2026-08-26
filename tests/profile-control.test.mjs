import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [ui, polish] = await Promise.all([
  readFile(new URL('../src/ui.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/judge-polish.css', import.meta.url), 'utf8')
]);

test('top-right profile button has a real click interaction', () => {
  assert.match(ui, /#profileMenuButton['"]\)\.addEventListener\(['"]click['"]/);
  assert.match(ui, /#profileMenu['"]\)/);
  assert.match(ui, /aria-expanded/);
});

test('profile control stays clickable above notification and capability layers', () => {
  assert.match(polish, /\.topbar-right\s*\{[^}]*isolation:\s*isolate/s);
  assert.match(polish, /\.profile-menu-wrap\s*\{[^}]*z-index:\s*100[^}]*pointer-events:\s*auto/s);
  assert.match(polish, /\.profile-button\s*\{[^}]*z-index:\s*2[^}]*pointer-events:\s*auto/s);
  assert.match(polish, /\.profile-menu\s*\{[^}]*z-index:\s*110[^}]*pointer-events:\s*auto/s);
  assert.match(polish, /\.notification-wrap\s*\{[^}]*z-index:\s*80/s);
  assert.match(polish, /\.capability-panel\s*\{[^}]*z-index:\s*70/s);
});
