import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const root = new URL('..', import.meta.url);

function runBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'pipe' });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr || `build exited ${code}`)));
  });
}

test('Vercel serves only the tested dist build', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.cleanUrls, true);
});

test('production build loads both stylesheets before application JavaScript', async () => {
  await runBuild();
  try {
    const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
    const base = html.indexOf('href="/src/styles.css"');
    const polish = html.indexOf('id="advocate-judge-polish-css"');
    const script = html.indexOf('src="/src/main.js"');
    assert.ok(base >= 0, 'base stylesheet missing');
    assert.ok(polish > base, 'judge polish stylesheet missing or out of order');
    assert.ok(script > polish, 'application JavaScript must load after render-blocking styles');
  } finally {
    await rm(new URL('../dist', import.meta.url), { recursive: true, force: true });
  }
});
