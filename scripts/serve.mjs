import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

export function resolveRequestFile(root, requestUrl = '/') {
  let raw;
  try {
    raw = decodeURIComponent(String(requestUrl).split('?')[0]);
  } catch {
    return { status: 400, file: null };
  }

  const relative = raw === '/' ? 'index.html' : raw.replace(/^\/+/, '');
  const absoluteRoot = resolve(root);
  const file = resolve(absoluteRoot, relative);
  const rootPrefix = absoluteRoot.endsWith(sep) ? absoluteRoot : `${absoluteRoot}${sep}`;
  if (file !== absoluteRoot && !file.startsWith(rootPrefix)) return { status: 403, file: null };
  return { status: 200, file };
}

export function createStaticServer(root = process.cwd()) {
  return http.createServer((req, res) => {
    const resolved = resolveRequestFile(root, req.url || '/');
    if (!resolved.file) {
      const message = resolved.status === 403 ? 'Forbidden' : 'Bad request';
      res.writeHead(resolved.status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(message);
      return;
    }

    try {
      if (!statSync(resolved.file).isFile()) throw new Error('not file');
      res.writeHead(200, { 'Content-Type': mime[extname(resolved.file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      createReadStream(resolved.file).pipe(res);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Not found');
    }
  });
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (entry === import.meta.url) {
  const port = Number(process.env.PORT || 3000);
  createStaticServer().listen(port, () => console.log(`Advocate mission control: http://localhost:${port}`));
}
