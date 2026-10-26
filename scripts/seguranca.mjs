// Segurança pública e violência.
//
// Sinesp (Ministério da Justiça): planilhas anuais com ocorrências e vítimas por município e mês, 2015 em diante.
// Disque 100 (Ministério dos Direitos Humanos): microdados de denúncias, usados para LGBTfobia e intolerância religiosa.
//
// Os arquivos originais são grandes (o Sinesp tem ~300 MB de XML por ano; o Disque 100 chega a 2 GB por semestre).
// Por isso cada arquivo é lido uma vez, em fluxo, e só os totais mensais ficam guardados em data/cache/.
// O site lê data/seguranca.json, montado a partir desses totais.

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registro, esperar } from './lib/http.mjs';
import { linhasDaPlanilha, mesDeDataExcel, entradasZip } from './lib/xlsx.mjs';
import { criarLeitorCsv } from './lib/csv.mjs';
import { hojeBrasilia, indiceMes, periodoDeIndice } from '../assets/js/nucleo.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const caminho = (rel) => join(RAIZ, rel);
const AGENTE = 'QuadroReal/1.0 (observatorio independente de dados publicos)';
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

async function lerJSON(rel, padrao) {
  try {
    return JSON.parse(await readFile(caminho(rel), 'utf8'));
  } catch (e) {
    if (padrao !== undefined) return padrao;
    throw e;
  }
}

async function gravarJSON(rel, obj) {
  await mkdir(dirname(caminho(rel)), { recursive: true });
  await writeFile(caminho(rel), JSON.stringify(obj) + '\n');
}

function intervaloDeMeses(inicio, fim) {
  const meses = [];
  for (let i = indiceMes(inicio); i <= indiceMes(fim); i++) meses.push(periodoDeIndice(i));
  return meses;
}

// ---------------------------------------------------------------------------
// Sinesp
// ---------------------------------------------------------------------------

async function baixarPlanilha(url, tentativas = 4) {
  let ultimo;
  for (let t = 1; t <= tentativas; t++) {
    const inicio = Date.now();
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': AGENTE }, signal: AbortSignal.timeout(300000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      const esperado = Number(resp.headers.get('content-length'));
      if (esperado && buf.length !== esperado) throw new Error(`download incompleto (${buf.length} de ${esperado} bytes)`);
      entradasZip(buf); // valida a integridade do arquivo
      registro.push({ url, ok: true, status: resp.status, ms: Date.now() - inicio, bytes: buf.length });
      return buf;
    } catch (e) {
      ultimo = e;
      registro.push({ url, ok: false, ms: Date.now() - inicio, tentativa: t, erro: String(e.message) });
      if (t < tentativas) await esperar(5000 * t);
    }
  }
  throw ultimo;
}

// Muda quando a estrutura do cache muda, para forçar o reprocessamento.
const VERSAO_CACHE_SINESP = 2;

// Guarda todos os eventos da planilha pelo nome oficial; a escolha do que exibir fica na configuração.
async function processarAnoSinesp(ano, config) {
  const url = config.url.replace('{ano}', ano);
  const buf = await baixarPlanilha(url);
  const eventos = {};
  const abrangencias = {};
  let linhas = 0;
  let cabecalho = true;
  for await (const l of linhasDaPlanilha(buf)) {
    if (cabecalho) {
      cabecalho = false;
      if (l.A !== 'uf' || l.C !== 'evento' || l.D !== 'data_referencia') throw new Error(`colunas inesperadas na planilha de ${ano}`);
      continue;
    }
    linhas++;
    const evento = String(l.C || '').trim();
    const mes = mesDeDataExcel(l.D);
    const uf = String(l.A || '').trim().toUpperCase();
    if (!evento || !mes || !mes.startsWith(String(ano)) || !UFS.includes(uf)) continue;
    const valor = typeof l.K === 'number' ? l.K : typeof l.L === 'number' ? l.L : typeof l.M === 'number' ? l.M : null;
    if (valor == null) continue;
    const m = Number(mes.slice(5, 7)) - 1;
    eventos[evento] ??= { porUf: {} };
    eventos[evento].porUf[uf] ??= Array(12).fill(null);
    eventos[evento].porUf[uf][m] = (eventos[evento].porUf[uf][m] ?? 0) + valor;
    const ab = `${evento}|${l.N || 'não informada'}`;
    abrangencias[ab] = (abrangencias[ab] || 0) + valor;
  }
  if (!linhas) throw new Error(`a planilha de ${ano} veio sem linhas`);
  return {
    versao: VERSAO_CACHE_SINESP,
    ano,
    url,
    processadoEm: new Date().toISOString(),
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
    linhas,
    eventos,
    abrangencias,
  };
}

export async function coletarSinesp(ctx, { todos = false } = {}) {
  const config = (await lerJSON('config/seguranca.json')).sinesp;
  const anoAtual = Number(ctx.hoje.slice(0, 4));
  const avisos = [];
  for (let ano = config.anoInicial; ano <= anoAtual; ano++) {
    const rel = `data/cache/sinesp/${ano}.json`;
    const cache = await lerJSON(rel, null);
    const recente = ano > anoAtual - config.anosRecentesParaRecoletar;
    const cacheValido = cache?.versao === VERSAO_CACHE_SINESP;
    if (cacheValido && !recente && !todos) continue;
    try {
      const inicio = Date.now();
      const r = await processarAnoSinesp(ano, config);
      if (cacheValido && cache.sha256 === r.sha256) {
        console.log(`  Sinesp ${ano}: sem mudanças`);
        continue;
      }
      await gravarJSON(rel, r);
      console.log(`✓ Sinesp ${ano}: ${r.linhas} linhas em ${Math.round((Date.now() - inicio) / 1000)}s`);
    } catch (e) {
      if (String(e.message).includes('HTTP 404') && ano === anoAtual) {
        console.log(`  Sinesp ${ano}: planilha do ano ainda não publicada`);
        continue;
      }
      avisos.push(`Sinesp ${ano}: ${e.message}${cache ? ' (mantido o processamento anterior)' : ''}`);
    }
  }
  return avisos;
}

function montarSinesp(todosCaches, config) {
  const caches = todosCaches.filter((c) => c.versao === VERSAO_CACHE_SINESP);
  if (!caches.length) throw new Error('nenhum ano do Sinesp processado na versão atual');
  const anos = caches.map((c) => c.ano).sort();
  const meses = intervaloDeMeses(`${anos[0]}-01`, `${anos[anos.length - 1]}-12`);
  const eventos = {};
  for (const ev of config.eventos) {
    const brasil = Array(meses.length).fill(null);
    const porUf = Object.fromEntries(UFS.map((uf) => [uf, Array(meses.length).fill(null)]));
    const ufsComDados = Array(meses.length).fill(0);
    for (const c of caches) {
      const nome = Object.keys(c.eventos).find((n) => n.toLowerCase() === ev.evento.toLowerCase());
      const dados = c.eventos[nome]?.porUf || {};
      const desloc = meses.indexOf(`${c.ano}-01`);
      for (const [uf, valores] of Object.entries(dados)) {
        valores.forEach((v, m) => {
          if (v == null) return;
          const i = desloc + m;
          porUf[uf][i] = v;
          brasil[i] = (brasil[i] ?? 0) + v;
          ufsComDados[i]++;
        });
      }
    }
    eventos[ev.id] = { ...ev, brasil, porUf, ufsComDados };
  }

  // No Sinesp, homicídio doloso e feminicídio são naturezas separadas (ver notaFeminicidio na configuração).
  const somaSeries = (series) => series[0].map((_, i) => (series.every((s) => s[i] == null) ? null : series.reduce((t, s) => t + (s[i] ?? 0), 0)));
  const composto = (id, partes, props) => {
    eventos[id] = {
      id,
      grupo: 'vida',
      unidade: 'vítimas',
      composto: partes,
      ...props,
      brasil: somaSeries(partes.map((p) => eventos[p].brasil)),
      porUf: Object.fromEntries(UFS.map((uf) => [uf, somaSeries(partes.map((p) => eventos[p].porUf[uf]))])),
      ufsComDados: eventos[partes[0]].ufsComDados,
    };
  };
  composto('homicidio', ['homicidioDoloso', 'feminicidio'], {
    nome: 'Homicídios dolosos e feminicídios',
    descricao: 'Assassinatos intencionais: homicídios dolosos somados aos feminicídios, que o Sinesp registra separadamente.',
  });
  composto('cvli', ['homicidioDoloso', 'feminicidio', 'latrocinio', 'lesaoMorte'], {
    nome: 'Mortes violentas intencionais (CVLI)',
    descricao: 'Homicídios dolosos, feminicídios, latrocínios e lesões corporais seguidas de morte: o indicador usado para medir assassinatos no país. Não inclui mortes por intervenção policial, mostradas à parte.',
  });

  // Último mês com dados de pelo menos 20 estados; meses posteriores ficam de fora para não parecerem quedas.
  let ultimo = -1;
  eventos.cvli.ufsComDados.forEach((n, i) => {
    if (n >= 20) ultimo = i;
  });
  if (ultimo < 0) throw new Error('nenhum mês do Sinesp tem dados de pelo menos 20 estados');
  const corte = ultimo + 1;
  for (const ev of Object.values(eventos)) {
    ev.brasil = ev.brasil.slice(0, corte);
    ev.ufsComDados = ev.ufsComDados.slice(0, corte);
    for (const uf of UFS) ev.porUf[uf] = ev.porUf[uf].slice(0, corte);
  }
  return {
    meses: meses.slice(0, corte),
    atualizadoAte: meses[ultimo],
    ufs: UFS,
    eventos,
    grupos: config.grupos,
    notaFeminicidio: config.notaFeminicidio,
    arquivos: caches.map((c) => ({ ano: c.ano, url: c.url, processadoEm: c.processadoEm, bytes: c.bytes, sha256: c.sha256, linhas: c.linhas })),
    pagina: config.pagina,
  };
}

// Separa os números por estado num arquivo próprio, carregado só quando o leitor escolhe um estado.
function separarPorUf(bloco, chaves) {
  if (!bloco) return [bloco, null];
  const porUf = {};
  const leve = structuredClone(bloco);
  for (const chave of chaves) {
    for (const [id, item] of Object.entries(leve[chave] || {})) {
      if (item?.porUf) {
        porUf[id] = item.porUf;
        delete item.porUf;
      }
    }
  }
  if (leve.porUf) {
    Object.assign(porUf, leve.porUf);
    delete leve.porUf;
  }
  return [leve, porUf];
}

// ---------------------------------------------------------------------------
// Disque 100
// ---------------------------------------------------------------------------

const ORDEM = { primeiro: 1, segundo: 2, terceiro: 3, quarto: 4 };

function periodoNominal(parte, tipo, ano) {
  const n = ORDEM[parte];
  const [ini, fim] = tipo === 'semestre' ? [(n - 1) * 6 + 1, n * 6] : [(n - 1) * 3 + 1, n * 3];
  return { inicio: `${ano}-${String(ini).padStart(2, '0')}`, fim: `${ano}-${String(fim).padStart(2, '0')}` };
}

async function listarArquivosDisque100(config) {
  const resp = await fetch(config.paginaLista, { headers: { 'User-Agent': AGENTE }, signal: AbortSignal.timeout(60000) });
  if (!resp.ok) throw new Error(`lista do Disque 100: HTTP ${resp.status}`);
  const html = await resp.text();
  const re = new RegExp(`href="([^"]*${config.padraoLinks})"`, 'g');
  const vistos = new Map();
  for (const m of html.matchAll(re)) {
    const [, pagina, parte, tipo, ano] = m;
    const chave = `${ano}-${tipo}-${parte}`;
    if (!vistos.has(chave)) vistos.set(chave, { pagina, nome: `${parte}-${tipo}-${ano}`, ...periodoNominal(parte, tipo, ano) });
  }
  const arquivos = [];
  for (const a of vistos.values()) {
    const r = await fetch(a.pagina, { redirect: 'manual', headers: { 'User-Agent': AGENTE }, signal: AbortSignal.timeout(60000) });
    const destino = r.headers.get('location');
    if (!destino || !/\.csv$/i.test(destino)) continue;
    const cabeca = await fetch(destino, { method: 'HEAD', headers: { 'User-Agent': AGENTE }, signal: AbortSignal.timeout(60000) });
    arquivos.push({
      ...a,
      url: destino,
      tamanho: Number(cabeca.headers.get('content-length')) || null,
      etag: cabeca.headers.get('etag'),
      modificadoEm: cabeca.headers.get('last-modified'),
    });
  }
  return arquivos.sort((x, y) => (x.inicio < y.inicio ? -1 : 1));
}

function classificarReligiao(valor, religioes) {
  const v = String(valor || '').trim().toUpperCase();
  if (!v) return 'naoInformada';
  for (const r of religioes) {
    if (r.termos.some((t) => v.includes(t))) return r.id;
  }
  return 'outras';
}

const normalizarNome = (s) => s.replace(/^﻿/, '').trim().replace(/\s+/g, '_');

function mesDaDenuncia(s) {
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return br ? `${br[3]}-${br[2]}` : null;
}

// Agregador de um arquivo do Disque 100: recebe o texto em pedaços e devolve os totais mensais.
export function agregadorDisque100(arq, config) {
  const religioes = config.religioes;
  const lgb = config.orientacoesLGB;
  const trans = config.marcadoresTrans;
  const meses = new Set(intervaloDeMeses(arq.inicio, arq.fim));
  const porMes = {};
  let col = null;
  let registros = 0;
  let foraDoPeriodo = 0;
  let temCodigoTrans = false;
  let formatoAntigo = false;

  const mesAg = (mes) =>
    (porMes[mes] ??= {
      total: new Set(),
      lgbt: new Set(),
      homofobia: new Set(),
      transfobia: new Set(),
      religiosa: new Set(),
      porReligiao: Object.fromEntries(religioes.map((r) => [r.id, new Set()])),
      lgbtUf: {},
      religiosaUf: {},
    });

  const leitor = criarLeitorCsv((campos) => {
    if (!col) {
      const nomes = campos.map(normalizarNome);
      if (nomes.length < config.colunasMinimas) {
        formatoAntigo = true;
        col = {};
        return;
      }
      const achar = (nome, posicao) => {
        const i = nomes.indexOf(nome);
        return i >= 0 ? i : posicao;
      };
      col = {
        hash: 0,
        data: achar('Data_de_cadastro', 1),
        uf: achar('UF', 7),
        grupo: achar('Grupo_vulnerável', 12),
        genero: achar('Gênero_da_vítima', 16),
        orientacao: achar('Orientação_sexual_da_vítima', 17),
        religiao: achar('Religião_da_vítima', 32),
        violacao: achar('violacao', nomes.length - 1),
        total: nomes.length,
      };
      return;
    }
    if (formatoAntigo || campos.length !== col.total) return;
    registros++;
    const mes = mesDaDenuncia(campos[col.data]);
    if (!mes || !meses.has(mes)) {
      foraDoPeriodo++;
      return;
    }
    const id = campos[col.hash].slice(0, 20);
    const a = mesAg(mes);
    a.total.add(id);
    const uf = campos[col.uf];
    const orientacao = campos[col.orientacao].toUpperCase();
    const genero = campos[col.genero].toUpperCase();
    const ehTrans = trans.some((t) => orientacao.includes(t) || genero.includes(t));
    if (ehTrans) temCodigoTrans = true;
    if (campos[col.grupo].toUpperCase().includes('LGBT')) {
      a.lgbt.add(id);
      if (ehTrans) a.transfobia.add(id);
      else if (lgb.some((t) => orientacao.includes(t))) a.homofobia.add(id);
      (a.lgbtUf[uf] ??= new Set()).add(id);
    }
    if (campos[col.violacao].toUpperCase().includes(config.marcadorViolacaoReligiosa)) {
      a.religiosa.add(id);
      a.porReligiao[classificarReligiao(campos[col.religiao], religioes)].add(id);
      (a.religiosaUf[uf] ??= new Set()).add(id);
    }
  });

  const contar = (s) => s.size;
  return {
    escrever: (texto) => leitor.escrever(texto),
    get formatoAntigo() {
      return formatoAntigo;
    },
    resultado() {
      leitor.terminar();
      const resumo = {};
      for (const [mes, a] of Object.entries(porMes)) {
        resumo[mes] = {
          total: contar(a.total),
          lgbt: contar(a.lgbt),
          homofobia: contar(a.homofobia),
          transfobia: contar(a.transfobia),
          religiosa: contar(a.religiosa),
          porReligiao: Object.fromEntries(Object.entries(a.porReligiao).map(([k, s]) => [k, contar(s)])),
          lgbtUf: Object.fromEntries(Object.entries(a.lgbtUf).map(([k, s]) => [k, contar(s)])),
          religiosaUf: Object.fromEntries(Object.entries(a.religiosaUf).map(([k, s]) => [k, contar(s)])),
        };
      }
      return { formatoAntigo, registros, foraDoPeriodo, temCodigoTrans, meses: resumo };
    },
  };
}

// Lê um arquivo do Disque 100 em fluxo, retomando o download do ponto em que parou se a conexão cair.
async function processarArquivoDisque100(arq, config) {
  const agregador = agregadorDisque100(arq, config);
  const decodificador = new TextDecoder('utf-8');
  let recebidos = 0;
  for (let tentativa = 1; ; tentativa++) {
    const inicio = Date.now();
    try {
      const resp = await fetch(arq.url, {
        headers: { 'User-Agent': AGENTE, ...(recebidos ? { Range: `bytes=${recebidos}-` } : {}) },
        signal: AbortSignal.timeout(4 * 3600e3),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      if (recebidos && resp.status !== 206) throw new Error('o servidor não aceitou retomar o download');
      for await (const pedaco of resp.body) {
        recebidos += pedaco.length;
        agregador.escrever(decodificador.decode(pedaco, { stream: true }));
        if (agregador.formatoAntigo) break;
      }
      registro.push({ url: arq.url, ok: true, status: resp.status, ms: Date.now() - inicio, bytes: recebidos });
      if (agregador.formatoAntigo || !arq.tamanho || recebidos >= arq.tamanho) break;
      throw new Error(`conexão encerrada em ${recebidos} de ${arq.tamanho} bytes`);
    } catch (e) {
      registro.push({ url: arq.url, ok: false, ms: Date.now() - inicio, tentativa, erro: String(e.message) });
      if (tentativa >= 8) throw e;
      await esperar(5000 * tentativa);
    }
  }
  agregador.escrever(decodificador.decode());
  return {
    nome: arq.nome,
    url: arq.url,
    inicio: arq.inicio,
    fim: arq.fim,
    etag: arq.etag,
    modificadoEm: arq.modificadoEm,
    tamanho: arq.tamanho,
    processadoEm: new Date().toISOString(),
    ...agregador.resultado(),
  };
}

export async function coletarDisque100(ctx, { apenas } = {}) {
  const config = (await lerJSON('config/seguranca.json')).disque100;
  const avisos = [];
  const arquivos = await listarArquivosDisque100(config);
  for (const arq of arquivos) {
    if (apenas && !apenas.includes(arq.nome)) continue;
    const rel = `data/cache/disque100/${arq.nome}.json`;
    const cache = await lerJSON(rel, null);
    if (cache && cache.etag === arq.etag && cache.tamanho === arq.tamanho) continue;
    try {
      const inicio = Date.now();
      console.log(`  Disque 100 ${arq.nome}: lendo ${Math.round((arq.tamanho || 0) / 1e6)} MB…`);
      const r = await processarArquivoDisque100(arq, config);
      await gravarJSON(rel, r);
      console.log(`✓ Disque 100 ${arq.nome}: ${r.registros} registros em ${Math.round((Date.now() - inicio) / 1000)}s${r.formatoAntigo ? ' (formato antigo, não usado)' : ''}`);
    } catch (e) {
      avisos.push(`Disque 100 ${arq.nome}: ${e.message}${cache ? ' (mantido o processamento anterior)' : ''}`);
    }
  }
  return avisos;
}

function montarDisque100(caches, config) {
  const validos = caches.filter((c) => !c.formatoAntigo && Object.keys(c.meses).length);
  if (!validos.length) throw new Error('nenhum arquivo do Disque 100 processado');
  // Cada mês vem do arquivo mais recente que o cobre (um semestre publicado depois substitui o trimestre).
  const fontePorMes = {};
  for (const c of [...validos].sort((a, b) => Date.parse(a.modificadoEm || 0) - Date.parse(b.modificadoEm || 0))) {
    for (const mes of intervaloDeMeses(c.inicio, c.fim)) if (c.meses[mes]) fontePorMes[mes] = c;
  }
  const todos = Object.keys(fontePorMes).sort();
  const meses = intervaloDeMeses(todos[0], todos[todos.length - 1]);
  const serie = (f) => meses.map((m) => (fontePorMes[m] ? f(fontePorMes[m].meses[m], fontePorMes[m]) : null));
  const religioes = config.religioes.map(({ id, nome }) => ({ id, nome }));
  return {
    meses,
    atualizadoAte: meses[meses.length - 1],
    series: {
      total: serie((x) => x.total),
      lgbt: serie((x) => x.lgbt),
      homofobia: serie((x) => x.homofobia),
      transfobia: serie((x, c) => (c.temCodigoTrans ? x.transfobia : null)),
      religiosa: serie((x) => x.religiosa),
    },
    porReligiao: Object.fromEntries(religioes.map((r) => [r.id, serie((x) => x.porReligiao[r.id] ?? 0)])),
    porUf: {
      lgbt: Object.fromEntries(UFS.map((uf) => [uf, serie((x) => x.lgbtUf[uf] ?? 0)])),
      religiosa: Object.fromEntries(UFS.map((uf) => [uf, serie((x) => x.religiosaUf[uf] ?? 0)])),
    },
    religioes,
    conferencias: config.conferencias || [],
    arquivos: caches.map(({ nome, url, inicio, fim, modificadoEm, tamanho, processadoEm, formatoAntigo, registros, temCodigoTrans }) => ({
      nome, url, inicio, fim, modificadoEm, tamanho, processadoEm, formatoAntigo, registros, temCodigoTrans,
    })),
    pagina: config.paginaLista,
  };
}

// ---------------------------------------------------------------------------

async function lerCaches(pasta) {
  try {
    const nomes = (await readdir(caminho(pasta))).filter((n) => n.endsWith('.json'));
    return Promise.all(nomes.map((n) => lerJSON(`${pasta}/${n}`)));
  } catch {
    return [];
  }
}

export async function montarSeguranca(ctx) {
  const config = await lerJSON('config/seguranca.json');
  const sinesp = await lerCaches('data/cache/sinesp');
  const disque = await lerCaches('data/cache/disque100');
  const anterior = await lerJSON('data/seguranca.json', {});
  const anteriorUf = await lerJSON('data/seguranca-uf.json', {});
  const avisos = [];
  // Se a montagem falhar, o bloco publicado anteriormente é mantido: nunca trocamos dados por um vazio.
  const montar = (nome, fn, chaves) => {
    try {
      return separarPorUf(fn(), chaves);
    } catch (e) {
      avisos.push(`${nome}: ${e.message}. Mantidos os dados publicados anteriormente.`);
      return [anterior[nome] ?? null, anteriorUf[nome] ?? null];
    }
  };
  const [sinespLeve, sinespUf] = montar('sinesp', () => montarSinesp(sinesp, config.sinesp), ['eventos']);
  const [disqueLeve, disqueUf] = montar('disque100', () => montarDisque100(disque, config.disque100), []);
  for (const a of avisos) console.warn(`! ${a}`);
  const saida = { geradoEm: ctx.agora, sentido: config.sentido, sinesp: sinespLeve, disque100: disqueLeve, avisos };
  await gravarJSON('data/seguranca.json', saida);
  await gravarJSON('data/seguranca-uf.json', { geradoEm: ctx.agora, sinesp: sinespUf, disque100: disqueUf });
  return saida;
}

// Execução direta: node scripts/seguranca.mjs [sinesp] [disque100] [--todos]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const ctx = { agora: new Date().toISOString(), hoje: hojeBrasilia() };
  const fazer = (p) => !args.filter((a) => !a.startsWith('--')).length || args.includes(p);
  const avisos = [];
  if (fazer('sinesp')) avisos.push(...(await coletarSinesp(ctx, { todos: args.includes('--todos') })));
  if (fazer('disque100')) {
    const apenas = args.find((a) => a.startsWith('--apenas='))?.slice(9).split(',');
    avisos.push(...(await coletarDisque100(ctx, { apenas })));
  }
  const s = await montarSeguranca(ctx);
  console.log(`Sinesp até ${s.sinesp?.atualizadoAte ?? '—'}; Disque 100 até ${s.disque100?.atualizadoAte ?? '—'}`);
  for (const a of avisos) console.warn(`! ${a}`);
}
