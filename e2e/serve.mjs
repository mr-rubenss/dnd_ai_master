// Статический сервер для e2e-тестов: отдаёт собранный dist/ по пути /<repo>/, как GitHub Pages.
// (vite preview не подходит: в Vite 8 он отвечает 404 на запросы модулей с Sec-Fetch-Dest: script.)
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', 'dist')
const BASE = '/dnd_ai_master/'
const PORT = Number(process.env.PORT ?? 4173)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')
  if (!pathname.startsWith(BASE)) {
    res.writeHead(302, { Location: BASE }).end()
    return
  }
  let file = normalize(join(ROOT, decodeURIComponent(pathname.slice(BASE.length))))
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end()
    return
  }
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html')
    statSync(file)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found')
    return
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
}).listen(PORT, '127.0.0.1', () => console.log(`e2e: dist/ на http://127.0.0.1:${PORT}${BASE}`))
