#!/usr/bin/env node
/* Minimal static server for the Playwright harness (tests/browser.spec.mjs).
 * Serves the repo root so index.html and tests/test.html load the way the
 * live site serves them. version.txt is written at deploy time from the
 * release tag; when the repo has none, a fixed stand-in is served so the
 * footer fetch behaves as it does in production and screenshots stay stable.
 * Synced from the trainer-engine repo; do not edit in an app repo. */
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || process.env.PORT || 8123);

const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.txt': 'text/plain', '.md': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf', '.woff2': 'font/woff2',
};

http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.normalize(path.join(root, pathname));
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, {
      'content-type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    if (pathname === '/version.txt') {
      res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      res.end('0.0.0-test\n');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found: ' + pathname);
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} at http://127.0.0.1:${port}/`);
});
