#!/usr/bin/env node
// Servidor estático mínimo para ver o site localmente: node scripts/servir.mjs [porta]
// (o site precisa ser servido por HTTP porque lê os arquivos de data/ com fetch).

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.env.PORT || process.argv[2] || 8080);
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    const caminho = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let arquivo = normalize(join(RAIZ, caminho));
    if (!arquivo.startsWith(RAIZ)) throw Object.assign(new Error('fora da raiz'), { code: 'ENOENT' });
    if ((await stat(arquivo)).isDirectory()) arquivo = join(arquivo, 'index.html');
    const corpo = await readFile(arquivo);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(arquivo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(corpo);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(e.code === 'ENOENT' ? 'Não encontrado' : 'Erro interno');
  }
}).listen(PORTA, () => console.log(`Quadro Real em http://localhost:${PORTA}`));
