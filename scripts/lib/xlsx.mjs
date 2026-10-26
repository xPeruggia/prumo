// Leitor mínimo de planilhas .xlsx, sem dependências.
// Um .xlsx é um zip de arquivos XML; a planilha do Sinesp tem ~300 MB de XML,
// então a descompressão e a leitura das linhas são feitas em fluxo, sem carregar tudo na memória.

import { Readable } from 'node:stream';
import { createInflateRaw, inflateRawSync } from 'node:zlib';

export function entradasZip(buf) {
  let fim = buf.length - 22;
  while (fim >= 0 && buf.readUInt32LE(fim) !== 0x06054b50) fim--;
  if (fim < 0) throw new Error('arquivo incompleto ou corrompido (fim do zip não encontrado)');
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const entradas = [];
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('diretório do zip inválido');
    const nomeLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const comentarioLen = buf.readUInt16LE(p + 32);
    entradas.push({
      nome: buf.toString('utf8', p + 46, p + 46 + nomeLen),
      metodo: buf.readUInt16LE(p + 10),
      comprimido: buf.readUInt32LE(p + 20),
      offset: buf.readUInt32LE(p + 42),
    });
    p += 46 + nomeLen + extraLen + comentarioLen;
  }
  return entradas;
}

function bytesDaEntrada(buf, e) {
  const nomeLen = buf.readUInt16LE(e.offset + 26);
  const extraLen = buf.readUInt16LE(e.offset + 28);
  const ini = e.offset + 30 + nomeLen + extraLen;
  return buf.subarray(ini, ini + e.comprimido);
}

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodificar = (s) => s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (_, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTIDADES[e]);

function textosCompartilhados(buf, entradas) {
  const e = entradas.find((x) => x.nome === 'xl/sharedStrings.xml');
  if (!e) return [];
  const xml = (e.metodo === 8 ? inflateRawSync(bytesDaEntrada(buf, e)) : bytesDaEntrada(buf, e)).toString('utf8');
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decodificar([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join('')));
}

const CELULA = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

// Gera cada linha como objeto { A: valor, B: valor, ... } (texto ou número).
export async function* linhasDaPlanilha(buf, planilha = 'xl/worksheets/sheet1.xml') {
  const entradas = entradasZip(buf);
  const alvo = entradas.find((e) => e.nome === planilha);
  if (!alvo) throw new Error(`planilha ${planilha} não encontrada no arquivo`);
  const compartilhados = textosCompartilhados(buf, entradas);
  const fluxo = Readable.from([bytesDaEntrada(buf, alvo)]).pipe(createInflateRaw());
  const decodificador = new TextDecoder('utf-8');
  let resto = '';
  for await (const pedaco of fluxo) {
    resto += decodificador.decode(pedaco, { stream: true });
    const partes = resto.split('</row>');
    resto = partes.pop();
    for (const parte of partes) {
      const linha = {};
      for (const [, col, attrs, corpo] of parte.matchAll(CELULA)) {
        if (corpo == null) continue;
        const tipo = attrs.match(/t="(\w+)"/)?.[1];
        if (tipo === 'inlineStr') linha[col] = decodificar([...corpo.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join(''));
        else {
          const v = corpo.match(/<v>([^<]*)<\/v>/)?.[1];
          if (v == null) continue;
          if (tipo === 's') linha[col] = compartilhados[Number(v)];
          else if (tipo === 'str' || tipo === 'd') linha[col] = decodificar(v);
          else linha[col] = Number(v);
        }
      }
      yield linha;
    }
  }
}

// Datas do Excel são dias desde 30/12/1899.
export function mesDeDataExcel(valor) {
  if (typeof valor === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(valor) * 864e5);
    return d.toISOString().slice(0, 7);
  }
  const s = String(valor ?? '');
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return br ? `${br[3]}-${br[2]}` : null;
}
