// Clientes das fontes oficiais. Cada função devolve os dados já normalizados
// e a URL exata consultada, que é publicada junto com o número.

import { buscar, esperar, Vazio } from './http.mjs';
import { hojeBrasilia } from '../../assets/js/nucleo.js';

// ---------- Banco Central: Sistema Gerenciador de Séries Temporais (SGS) ----------

export const urlSgs = (codigo, ini, fim) =>
  `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados?formato=json&dataInicial=${ini}&dataFinal=${fim}`;
export const urlSgsUltimos = (codigo, n = 12) =>
  `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados/ultimos/${n}?formato=json`;

// O SGS limita consultas de séries diárias a janelas de 10 anos; pedimos de 5 em 5.
export async function sgs(codigo, anoInicial) {
  const hoje = hojeBrasilia();
  const anoFinal = Number(hoje.slice(0, 4));
  const pontos = new Map();
  for (let ano = anoInicial; ano <= anoFinal; ano += 5) {
    const ate = Math.min(ano + 4, anoFinal);
    let dados = [];
    try {
      dados = await buscar(urlSgs(codigo, `01/01/${ano}`, `31/12/${ate}`), { vazioEm404: true });
    } catch (e) {
      if (!(e instanceof Vazio)) throw e;
    }
    for (const { data, valor } of dados) {
      const [d, m, a] = data.split('/');
      const iso = `${a}-${m}-${d}`;
      const v = Number(valor);
      // A meta Selic é publicada com datas futuras até a próxima reunião do Copom: descartamos o que ainda não aconteceu.
      if (iso <= hoje && Number.isFinite(v)) pontos.set(iso, v);
    }
  }
  return {
    pontos: [...pontos.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    url: urlSgsUltimos(codigo),
  };
}

export function mensalDeDiaria(pontosDiarios, agregacao) {
  const meses = new Map();
  for (const [data, v] of pontosDiarios) {
    const mes = data.slice(0, 7);
    if (!meses.has(mes)) meses.set(mes, []);
    meses.get(mes).push(v);
  }
  return [...meses.entries()].map(([mes, vals]) => [
    mes,
    agregacao === 'media-mensal' ? Number((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(4)) : vals[vals.length - 1],
  ]);
}

export function mensalDeSgs(pontos) {
  // Séries mensais do SGS vêm datadas no dia 1 de cada mês.
  return pontos.map(([data, v]) => [data.slice(0, 7), v]);
}

// ---------- IBGE: SIDRA ----------

export const urlSidra = (caminho) => `https://apisidra.ibge.gov.br/values/${caminho}`;

export async function sidra(caminho, anoInicial) {
  const linhas = await buscar(urlSidra(caminho), { tempoLimite: 90000 });
  const [cabecalho, ...dados] = linhas;
  const chavePeriodo = Object.keys(cabecalho).find(
    (k) => /^D\dN$/.test(k) && /^(Mês|Trimestre|Trimestre Móvel|Ano)$/.test(cabecalho[k]),
  );
  const tipoPeriodo = cabecalho[chavePeriodo];
  const chaveCodigo = chavePeriodo.replace('N', 'C');
  const pontos = [];
  for (const linha of dados) {
    const v = Number(linha.V);
    if (!Number.isFinite(v) || linha.V.trim() === '' || /^[-.X]+$/.test(linha.V)) continue;
    const cod = linha[chaveCodigo];
    let periodo;
    if (tipoPeriodo === 'Ano') periodo = cod;
    else if (tipoPeriodo === 'Trimestre') periodo = `${cod.slice(0, 4)}-${String(Number(cod.slice(4)) * 3).padStart(2, '0')}`;
    else periodo = `${cod.slice(0, 4)}-${cod.slice(4, 6)}`;
    if (Number(periodo.slice(0, 4)) >= anoInicial) pontos.push([periodo, v]);
  }
  pontos.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const amostra = dados[0] || {};
  const chaveVariavel = Object.keys(cabecalho).find((k) => /^D\dN$/.test(k) && cabecalho[k] === 'Variável');
  return {
    pontos,
    nomeOficial: amostra[chaveVariavel] || null,
    unidadeOficial: amostra.MN || null,
    url: urlSidra(caminho.replace(/\/p\/all/, '/p/last%2012')),
  };
}

// ---------- Tesouro Nacional: SICONFI (Relatório Resumido da Execução Orçamentária da União) ----------

export const urlRreo = (ano, periodo, anexo) =>
  `https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo?an_exercicio=${ano}&nr_periodo=${periodo}` +
  `&co_tipo_demonstrativo=RREO&no_anexo=${encodeURIComponent(anexo)}&co_esfera=U&id_ente=1`;

export async function rreo(ano, periodo, anexo) {
  const itens = [];
  let offset = 0;
  for (;;) {
    const url = urlRreo(ano, periodo, anexo) + (offset ? `&offset=${offset}` : '');
    const resp = await buscar(url, { tempoLimite: 120000 });
    itens.push(...resp.items);
    await esperar(1100); // o SICONFI aceita cerca de uma requisição por segundo
    if (!resp.hasMore) break;
    offset += resp.items.length;
  }
  return { itens, url: urlRreo(ano, periodo, anexo) };
}

// ---------- Câmara dos Deputados: proposições ----------

export const paginaProposicao = (id) => `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${id}`;

export async function proposicoes({ siglaTipo, ano, autor }) {
  const todas = [];
  for (let pagina = 1; ; pagina++) {
    const url =
      `https://dadosabertos.camara.leg.br/api/v2/proposicoes?siglaTipo=${siglaTipo}&ano=${ano}` +
      (autor ? `&autor=${encodeURIComponent(autor)}` : '') +
      `&itens=100&pagina=${pagina}&ordem=ASC&ordenarPor=id`;
    const resp = await buscar(url);
    todas.push(...resp.dados);
    if (!resp.links.some((l) => l.rel === 'next')) break;
  }
  return todas;
}

export async function detalheProposicao(id) {
  const resp = await buscar(`https://dadosabertos.camara.leg.br/api/v2/proposicoes/${id}`);
  return resp.dados;
}

// ---------- Notícias oficiais ----------

export async function noticiasIbge(qtd = 40) {
  const url = `https://servicodados.ibge.gov.br/api/v3/noticias/?qtd=${qtd}`;
  const resp = await buscar(url);
  return resp.items.map((n) => {
    const [d, m, resto] = n.data_publicacao.split('/');
    const [a, hora] = resto.split(' ');
    return {
      fonte: 'IBGE',
      fonteNome: 'Agência de Notícias do IBGE',
      id: `ibge-${n.id}`,
      tipo: n.tipo === 'Release' ? 'Divulgação de dado oficial' : 'Notícia institucional',
      titulo: n.titulo,
      resumo: n.introducao,
      publicadoEm: `${a}-${m}-${d}T${hora}-03:00`,
      link: n.link.replace(/^http:/, 'https:'),
      editorias: n.editorias,
    };
  });
}

export async function notasBcb(qtd = 25) {
  const url = `https://www.bcb.gov.br/api/servico/sitebcb/notasimprensa?quantidade=${qtd}`;
  const resp = await buscar(url);
  return resp.conteudo.map((n) => ({
    fonte: 'BCB',
    fonteNome: 'Banco Central do Brasil',
    id: `bcb-${n.Id}`,
    tipo: 'Nota à imprensa',
    titulo: n.titulo.trim(),
    resumo: '',
    publicadoEm: n.dataPublicacao,
    link: `https://www.bcb.gov.br/detalhenoticia/${n.Id}/nota`,
  }));
}

// ---------- Banco Central: PTAX e Focus (Olinda) ----------

export async function ptaxDoDia(dataISO) {
  const [a, m, d] = dataISO.split('-');
  const url =
    `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)` +
    `?@dataCotacao='${m}-${d}-${a}'&$format=json`;
  const resp = await buscar(url);
  const cot = resp.value[resp.value.length - 1];
  return cot ? { venda: cot.cotacaoVenda, compra: cot.cotacaoCompra, url } : null;
}

export async function focusAnual(indicador) {
  const filtro = encodeURIComponent(`Indicador eq '${indicador}' and baseCalculo eq 0`);
  const url =
    `https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais` +
    `?$top=8&$filter=${filtro}&$orderby=Data%20desc&$format=json`;
  const resp = await buscar(url);
  return { linhas: resp.value, url };
}
