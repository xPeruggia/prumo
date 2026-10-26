// Clientes das fontes oficiais. Cada função devolve os dados já normalizados
// e a URL exata consultada, que é publicada junto com o número.

import { buscar, esperar, Vazio } from './http.mjs';
import { hojeBrasilia } from '../../assets/js/nucleo.js';
import { normalizarNoticiasIbge } from './verificacao.mjs';

// ---------- Banco Central: Sistema Gerenciador de Séries Temporais (SGS) ----------

export const urlSgs = (codigo, ini, fim) =>
  `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados?formato=json&dataInicial=${ini}&dataFinal=${fim}`;
export const urlSgsUltimos = (codigo, n = 12) =>
  `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados/ultimos/${n}?formato=json`;

// Uma janela de anos do SGS. Quando o servidor está instável, janelas longas estouram o tempo dele
// (resposta 502 ou página de erro); nesse caso a mesma janela é pedida de ano em ano.
async function janelaSgs(codigo, de, ate) {
  try {
    const dados = await buscar(urlSgs(codigo, `01/01/${de}`, `31/12/${ate}`), { vazioEm404: true, tentativas: de === ate ? 5 : 3 });
    // Em erro, o SGS às vezes devolve um objeto JSON em vez da lista de pontos.
    if (!Array.isArray(dados)) throw new Error(`resposta inesperada do SGS: ${JSON.stringify(dados).slice(0, 160)}`);
    return dados;
  } catch (e) {
    if (e instanceof Vazio) return [];
    if (de === ate) throw e;
    const dados = [];
    for (let ano = de; ano <= ate; ano++) {
      dados.push(...(await janelaSgs(codigo, ano, ano)));
      await esperar(400);
    }
    return dados;
  }
}

// O SGS limita consultas de séries diárias a janelas de 10 anos; pedimos de 5 em 5.
export async function sgs(codigo, anoInicial) {
  const hoje = hojeBrasilia();
  const anoFinal = Number(hoje.slice(0, 4));
  const pontos = new Map();
  for (let ano = anoInicial; ano <= anoFinal; ano += 5) {
    const dados = await janelaSgs(codigo, ano, Math.min(ano + 4, anoFinal));
    await esperar(400); // intervalo entre consultas ao SGS, que limita rajadas de acesso
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

export const URL_NOTICIAS_IBGE = 'https://servicodados.ibge.gov.br/api/v3/noticias/?qtd=40';

export async function noticiasIbge() {
  // Poucas tentativas: o servidor recusa conexões de fora do Brasil (o navegador do leitor cobre essa falha).
  return normalizarNoticiasIbge(await buscar(URL_NOTICIAS_IBGE, { tentativas: 2 }));
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

// Fechamentos diários da PTAX de uma moeda num período (datas AAAA-MM-DD).
export async function ptaxPeriodo(moeda, inicio, fim) {
  const br = (iso) => {
    const [a, m, d] = iso.split('-');
    return `${m}-${d}-${a}`;
  };
  const url =
    `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)` +
    `?@moeda='${moeda}'&@dataInicial='${br(inicio)}'&@dataFinalCotacao='${br(fim)}'` +
    `&$filter=${encodeURIComponent("tipoBoletim eq 'Fechamento'")}&$format=json&$select=cotacaoVenda,dataHoraCotacao`;
  const resp = await buscar(url);
  return { pontos: resp.value.map((v) => [v.dataHoraCotacao.slice(0, 10), v.cotacaoVenda]), url };
}

// Arrecadação federal por tributo, mês e estado (Receita Federal, CSV em Latin-1).
export const URL_ARRECADACAO_RECEITA = 'https://www.gov.br/receitafederal/dados/arrecadacao-estado.csv';

export async function arrecadacaoReceita() {
  const bytes = await buscar(URL_ARRECADACAO_RECEITA, { tipo: 'bytes', tempoLimite: 180000 });
  const texto = new TextDecoder('latin1').decode(bytes);
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(';'));
  return { cabecalho: linhas[0], linhas: linhas.slice(1) };
}

// Busca de proposições por palavra-chave (a API procura na ementa e na indexação).
export async function proposicoesPorPalavra({ siglaTipo, ano, palavra, maxPaginas = 10 }) {
  const todas = [];
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const url =
      `https://dadosabertos.camara.leg.br/api/v2/proposicoes?siglaTipo=${siglaTipo}&ano=${ano}` +
      `&keywords=${encodeURIComponent(palavra)}&itens=100&pagina=${pagina}&ordem=ASC&ordenarPor=id`;
    const resp = await buscar(url);
    todas.push(...resp.dados);
    if (!resp.links.some((l) => l.rel === 'next')) break;
  }
  return todas;
}

export async function focusAnual(indicador) {
  const filtro = encodeURIComponent(`Indicador eq '${indicador}' and baseCalculo eq 0`);
  const url =
    `https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais` +
    `?$top=8&$filter=${filtro}&$orderby=Data%20desc&$format=json`;
  const resp = await buscar(url);
  return { linhas: resp.value, url };
}
