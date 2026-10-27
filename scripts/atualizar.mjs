#!/usr/bin/env node
// Coleta diária do Quadro Real.
// Busca cada indicador na fonte oficial, confere com uma segunda fonte quando existe,
// testa a plausibilidade dos valores e grava os arquivos em data/.
// Se uma fonte falhar, o último dado válido é mantido e marcado como tal: nada é inventado.
//
// Uso: node scripts/atualizar.mjs            (tudo)
//      node scripts/atualizar.mjs series noticias   (só as partes indicadas)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registro } from './lib/http.mjs';
import * as F from './lib/fontes.mjs';
import { cruzar, toleranciaPadrao, testarPlausibilidade, triarNoticias } from './lib/verificacao.mjs';
import { hojeBrasilia, mandatoEm } from '../assets/js/nucleo.js';
import { coletarSinesp, coletarDisque100, montarSeguranca } from './seguranca.mjs';
import { coletarTributos } from './tributos.mjs';
import { coletarImprensa } from './imprensa.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const caminho = (rel) => join(RAIZ, rel);

async function lerJSON(rel, padrao) {
  try {
    return JSON.parse(await readFile(caminho(rel), 'utf8'));
  } catch (e) {
    if (padrao !== undefined) return padrao;
    throw e;
  }
}

// Mantém cada par [período, valor] numa linha só, para o diff do git continuar legível.
async function gravarJSON(rel, obj) {
  await mkdir(dirname(caminho(rel)), { recursive: true });
  const texto = JSON.stringify(obj, null, 1).replace(/\[\n\s*("[^"\n]*"),\n\s*(-?[\d.eE+-]+)\n\s*\]/g, '[$1,$2]');
  await writeFile(caminho(rel), texto + '\n');
}

const avisos = [];
const avisar = (parte, mensagem) => {
  avisos.push({ parte, mensagem });
  console.warn(`! [${parte}] ${mensagem}`);
};

// ---------------------------------------------------------------------------
// Séries de indicadores
// ---------------------------------------------------------------------------

const cacheSgs = new Map();
function sgsComCache(codigo, anoInicial) {
  if (!cacheSgs.has(codigo)) cacheSgs.set(codigo, F.sgs(codigo, anoInicial));
  return cacheSgs.get(codigo);
}

function codigoPeriodoSidra(periodo, periodicidade) {
  if (periodicidade === 'anual') return periodo;
  const [a, m] = periodo.split('-');
  return periodicidade === 'trimestral' ? `${a}0${Math.ceil(Number(m) / 3)}` : `${a}${m}`;
}

function dataBr(iso) {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

// Consultas que o próprio leitor pode refazer no navegador (as APIs do BCB e do IBGE aceitam CORS).
function consultaNoNavegador(fonte, def, periodo, dia) {
  if (fonte.tipo === 'sgs') {
    const data = def.periodicidade === 'diaria' ? dia : `${periodo}-01`;
    return { tipo: 'sgs', orgao: fonte.orgao, rotulo: `SGS ${fonte.codigo}`, url: F.urlSgs(fonte.codigo, dataBr(data), dataBr(data)) };
  }
  if (fonte.tipo === 'sidra') {
    const p = codigoPeriodoSidra(periodo, def.periodicidade);
    return { tipo: 'sidra', orgao: fonte.orgao, rotulo: `SIDRA ${fonte.caminho.match(/t\/(\d+)/)[1]}`, url: F.urlSidra(fonte.caminho.replace('/p/all', `/p/${p}`)) };
  }
  return null;
}

const inverter = (pontos) => pontos?.map(([k, v]) => [k, v === 0 ? 0 : -v]) ?? null;

async function coletarPrimaria(def, anoInicial) {
  const p = def.primaria;
  if (p.tipo === 'sgs') {
    const r = await sgsComCache(p.codigo, anoInicial);
    const diaria = def.periodicidade === 'diaria';
    return {
      pontos: diaria ? F.mensalDeDiaria(r.pontos, def.agregacao) : F.mensalDeSgs(r.pontos),
      ultimosDiarios: diaria ? r.pontos.slice(-90) : null,
      fonte: { orgao: p.orgao, sistema: 'SGS', codigo: p.codigo, referencia: `Série ${p.codigo} do SGS`, url: r.url },
    };
  }
  const r = await F.sidra(p.caminho, anoInicial);
  const tabela = p.caminho.match(/t\/(\d+)/)[1];
  const variavel = p.caminho.match(/v\/(\d+)/)[1];
  return {
    pontos: r.pontos,
    ultimosDiarios: null,
    fonte: {
      orgao: p.orgao,
      sistema: 'SIDRA',
      tabela: Number(tabela),
      variavel: Number(variavel),
      referencia: `Tabela ${tabela}, variável ${variavel} do SIDRA`,
      nomeOficial: r.nomeOficial,
      unidadeOficial: r.unidadeOficial,
      url: r.url,
    },
  };
}

async function conferir(def, pontos, ultimosDiarios, anoInicial) {
  const c = def.conferencia;
  const tol = c.tolerancia ?? toleranciaPadrao(def.casas);
  if (c.tipo === 'sgs') {
    const r = await sgsComCache(c.codigo, anoInicial);
    let sec = F.mensalDeSgs(r.pontos);
    if (def.transformacao === 'inverter-sinal') sec = inverter(sec);
    return {
      tipo: 'sgs', orgao: c.orgao, sistema: 'SGS', referencia: `Série ${c.codigo} do SGS`,
      descricao: `O Banco Central republica o mesmo indicador na série ${c.codigo} do SGS. Comparamos os últimos 12 períodos em comum.`,
      url: r.url, tolerancia: tol, ...cruzar(pontos, sec, tol),
    };
  }
  if (c.tipo === 'sidra') {
    const r = await F.sidra(c.caminho, anoInicial);
    return {
      tipo: 'sidra', orgao: c.orgao, sistema: 'SIDRA', referencia: c.caminho,
      descricao: 'O IBGE publica o mesmo indicador no SIDRA. Comparamos os últimos 12 períodos em comum.',
      url: r.url, tolerancia: tol, ...cruzar(pontos, r.pontos, tol),
    };
  }
  if (c.tipo === 'razao') {
    const [num, den] = await Promise.all([sgsComCache(c.numerador, anoInicial), sgsComCache(c.denominador, anoInicial)]);
    const pib = new Map(F.mensalDeSgs(den.pontos));
    const calculado = F.mensalDeSgs(num.pontos)
      .filter(([k]) => pib.has(k))
      .map(([k, v]) => [k, Number(((v / pib.get(k)) * 100).toFixed(4))]);
    return {
      tipo: 'razao', orgao: c.orgao, sistema: 'SGS', referencia: `SGS ${c.numerador} ÷ SGS ${c.denominador}`,
      descricao: `Recalculamos o percentual dividindo o saldo em reais (SGS ${c.numerador}) pelo PIB acumulado em 12 meses (SGS ${c.denominador}). Diferenças de até ${String(c.tolerancia).replace('.', ',')} ponto vêm de arredondamento.`,
      url: num.url, urlDenominador: den.url, tolerancia: c.tolerancia, ...cruzar(pontos, calculado, c.tolerancia),
    };
  }
  if (c.tipo === 'ptax') {
    const [dia, valor] = ultimosDiarios[ultimosDiarios.length - 1];
    const ptax = await F.ptaxDoDia(dia);
    if (!ptax) throw new Error(`O serviço PTAX não tem cotação para ${dia}.`);
    const diferenca = Number((valor - ptax.venda).toFixed(6));
    const ok = Math.abs(diferenca) <= 0.00005;
    return {
      tipo: 'ptax', orgao: c.orgao, sistema: 'PTAX', referencia: 'Serviço PTAX (Olinda)',
      descricao: 'Consultamos a cotação do mesmo dia no serviço PTAX do Banco Central, um sistema separado do SGS.',
      url: ptax.url, tolerancia: 0.00005, status: ok ? 'confere' : 'diverge', periodo: dia,
      valorPrimaria: valor, valorConferencia: ptax.venda, diferenca, comparados: 1, conferidos: ok ? 1 : 0, maiorDiferenca: Math.abs(diferenca),
    };
  }
  throw new Error(`Tipo de conferência desconhecido: ${c.tipo}`);
}

async function coletarSerie(def, ctx) {
  let { pontos, ultimosDiarios, fonte } = await coletarPrimaria(def, ctx.anoInicial);
  if (def.transformacao === 'inverter-sinal') {
    pontos = inverter(pontos);
    ultimosDiarios = inverter(ultimosDiarios);
  }
  const problema = testarPlausibilidade(pontos, def.limites, ctx.hoje);
  if (problema) throw new Error(problema);

  let conferencia = null;
  let status = 'fonte-unica';
  if (def.conferencia) {
    try {
      conferencia = await conferir(def, pontos, ultimosDiarios, ctx.anoInicial);
      status = conferencia.status;
    } catch (e) {
      conferencia = { tipo: def.conferencia.tipo, orgao: def.conferencia.orgao, status: 'sem-conferencia', erro: String(e.message || e) };
      status = 'sem-conferencia';
      avisar('series', `${def.id}: segunda fonte indisponível (${conferencia.erro})`);
    }
    if (status === 'diverge') avisar('series', `${def.id}: divergência entre fontes em ${conferencia.periodo}`);
  }

  const [periodo, valor] = pontos[pontos.length - 1];
  const dia = ultimosDiarios?.[ultimosDiarios.length - 1];
  const noNavegador = [consultaNoNavegador(def.primaria, def, periodo, dia?.[0])];
  if (def.conferencia?.tipo === 'sgs' && conferencia?.periodo) {
    noNavegador.push(consultaNoNavegador({ tipo: 'sgs', ...def.conferencia }, def, conferencia.periodo, dia?.[0]));
  }

  return {
    ...metadados(def),
    fonte: { ...fonte, consultadoEm: ctx.agora },
    conferencia,
    status,
    ultimo: { periodo, valor },
    anterior: pontos.length > 1 ? { periodo: pontos[pontos.length - 2][0], valor: pontos[pontos.length - 2][1] } : null,
    ultimoDiario: dia ? { data: dia[0], valor: dia[1] } : null,
    ultimosDiarios,
    noNavegador: noNavegador.filter(Boolean).map((q) => ({
      ...q,
      periodo: def.periodicidade === 'diaria' ? dia[0] : q === noNavegador[0] ? periodo : conferencia.periodo,
      valorEsperado: def.periodicidade === 'diaria' ? dia[1] : q === noNavegador[0] ? valor : conferencia.valorConferencia,
      inverterSinal: def.transformacao === 'inverter-sinal',
    })),
    pontos,
  };
}

function metadados(def) {
  const { primaria, conferencia, limites, ...resto } = def;
  return resto;
}

async function coletarSeries(ctx) {
  const config = await lerJSON('config/series.json');
  const anterior = await lerJSON('data/indicadores.json', { series: {} });
  ctx.anoInicial = Number(config.inicioHistorico.slice(0, 4));
  const series = {};
  for (const def of config.series) {
    try {
      series[def.id] = await coletarSerie(def, ctx);
      console.log(`✓ ${def.id.padEnd(12)} ${series[def.id].ultimo.periodo}  ${series[def.id].ultimo.valor}  [${series[def.id].status}]`);
    } catch (e) {
      const velho = anterior.series?.[def.id];
      avisar('series', `${def.id}: coleta falhou (${e.message}).${velho ? ' Mantido o último dado válido.' : ''}`);
      if (velho) {
        series[def.id] = { ...velho, ...metadados(def), status: 'falha', falha: { em: ctx.agora, erro: String(e.message), statusAnterior: velho.status } };
      }
    }
  }
  const auxiliares = {};
  for (const def of config.auxiliares) {
    try {
      const { pontos, fonte } = await coletarPrimaria(def, ctx.anoInicial);
      auxiliares[def.id] = { uso: def.uso, fonte, pontos };
    } catch (e) {
      avisar('series', `${def.id} (auxiliar): coleta falhou (${e.message}).`);
      if (anterior.auxiliares?.[def.id]) auxiliares[def.id] = anterior.auxiliares[def.id];
    }
  }
  const focus = await coletarFocus(ctx, anterior.focus);
  return { geradoEm: ctx.agora, temas: config.temas, notaSentido: config.notaSentido, metaInflacao: config.metaInflacao, series, auxiliares, focus, anterior };
}

async function coletarFocus(ctx, anterior) {
  const indicadores = [
    ['IPCA', 'Inflação (IPCA)', '%'],
    ['PIB Total', 'Crescimento do PIB', '%'],
    ['Selic', 'Selic no fim do ano', '% a.a.'],
    ['Câmbio', 'Dólar no fim do ano', 'R$'],
  ];
  try {
    const itens = [];
    let dataPesquisa = null;
    let url = null;
    for (const [codigo, nome, unidade] of indicadores) {
      const r = await F.focusAnual(codigo);
      url ??= r.url;
      const maisRecente = r.linhas[0]?.Data;
      dataPesquisa = dataPesquisa && dataPesquisa > maisRecente ? dataPesquisa : maisRecente;
      const ano = Number(ctx.hoje.slice(0, 4));
      for (const ref of [ano, ano + 1]) {
        const linha = r.linhas.find((l) => l.Data === maisRecente && Number(l.DataReferencia) === ref);
        if (linha) itens.push({ indicador: codigo, nome, unidade, ano: ref, mediana: linha.Mediana, respondentes: linha.numeroRespondentes });
      }
    }
    return {
      dataPesquisa,
      itens,
      url,
      nota: 'Mediana das projeções de instituições financeiras coletadas pelo Banco Central no relatório Focus. É expectativa de mercado, não dado realizado.',
    };
  } catch (e) {
    avisar('focus', `Focus indisponível (${e.message}).`);
    return anterior ?? null;
  }
}

// ---------------------------------------------------------------------------
// Orçamento da União (RREO via SICONFI)
// ---------------------------------------------------------------------------

const ANO_INICIAL_ORCAMENTO = 2019;

const FUNCOES = [
  'Legislativa', 'Judiciária', 'Essencial à Justiça', 'Administração', 'Defesa Nacional', 'Segurança Pública',
  'Relações Exteriores', 'Assistência Social', 'Previdência Social', 'Saúde', 'Trabalho', 'Educação', 'Cultura',
  'Direitos da Cidadania', 'Urbanismo', 'Habitação', 'Saneamento', 'Gestão Ambiental', 'Ciência e Tecnologia',
  'Agricultura', 'Organização Agrária', 'Indústria', 'Comércio e Serviços', 'Comunicações', 'Energia', 'Transporte',
  'Desporto e Lazer', 'Encargos Especiais', 'Reserva de Contingência',
];

function extrairAnexo1(itens) {
  const valor = (conta, coluna) => itens.find((i) => i.cod_conta === conta && i.coluna.startsWith(coluna))?.valor ?? null;
  const emp = 'DESPESAS EMPENHADAS ATÉ';
  return {
    receitaTributaria: valor('ReceitaTributaria', 'Até o Bimestre'),
    contribuicoes: valor('ReceitaDeContribuicoes', 'Até o Bimestre'),
    receitasCorrentes: valor('ReceitasCorrentes', 'Até o Bimestre'),
    despesaEmpenhada: valor('DespesasExcetoIntraOrcamentarias', emp),
    pessoal: valor('PessoalEEncargosSociais', emp),
    juros: valor('JurosEEncargosDaDivida', emp),
    beneficiosPrevidenciarios: valor('BeneficiosPrevidenciarios', emp),
    investimentosEmpenhados: valor('Investimentos', emp),
    investimentosLiquidados: valor('Investimentos', 'DESPESAS LIQUIDADAS ATÉ'),
    investimentosPagos: valor('Investimentos', 'DESPESAS PAGAS ATÉ'),
  };
}

function extrairAnexo2(itens) {
  const linhas = itens.filter(
    (i) => (i.rotulo || '').startsWith('Total das Despesas Exceto') && i.coluna.startsWith('DESPESAS EMPENHADAS ATÉ'),
  );
  const funcoes = [];
  const ajustes = [];
  let atual = null;
  let total = null;
  for (const l of linhas) {
    if (l.conta.startsWith('DESPESAS (EXCETO')) {
      total = l.valor;
    } else if (l.conta.startsWith('DESPESAS (INTRA')) {
      atual = null;
    } else if (FUNCOES.includes(l.conta)) {
      atual = { nome: l.conta, valor: l.valor, subfuncoes: [] };
      funcoes.push(atual);
    } else if (atual) {
      atual.subfuncoes.push({ nome: l.conta.replace(/^FU\d+ - /, ''), valor: l.valor });
    }
  }
  // Alguns anos (ex.: 2022) incluem o refinanciamento da dívida no anexo 2; os demais não.
  // Retiramos essa rolagem para que os anos fiquem comparáveis, e registramos o ajuste.
  for (const f of funcoes) {
    const rolagem = f.subfuncoes.filter((s) => /^Refinanciamento da Dívida/i.test(s.nome));
    for (const s of rolagem) {
      f.valor -= s.valor;
      total -= s.valor;
      ajustes.push({ funcao: f.nome, subfuncao: s.nome, valor: s.valor });
    }
    f.subfuncoes = f.subfuncoes.filter((s) => !rolagem.includes(s));
  }
  return { total, funcoes, ajustes };
}

async function rreoPeriodo(ano, periodo) {
  const a1 = await F.rreo(ano, periodo, 'RREO-Anexo 01');
  if (!a1.itens.length) return null;
  const a2 = await F.rreo(ano, periodo, 'RREO-Anexo 02');
  return {
    periodo,
    mesFinal: periodo * 2,
    ...extrairAnexo1(a1.itens),
    ...extrairAnexo2(a2.itens),
    urls: { anexo1: a1.url, anexo2: a2.url },
  };
}

async function ultimoPeriodoPublicado(ano, mesAtual) {
  for (let p = Math.min(6, Math.floor(mesAtual / 2)); p >= 1; p--) {
    const r = await F.rreo(ano, p, 'RREO-Anexo 01');
    if (r.itens.length) return p;
  }
  return null;
}

async function coletarOrcamento(ctx) {
  const anterior = await lerJSON('data/orcamento.json', { anos: [] });
  const anoHoje = Number(ctx.hoje.slice(0, 4));
  let anoRef = anoHoje;
  let periodoRef = await ultimoPeriodoPublicado(anoHoje, Number(ctx.hoje.slice(5, 7)));
  if (!periodoRef) {
    anoRef = anoHoje - 1;
    periodoRef = await ultimoPeriodoPublicado(anoRef, 12);
  }
  if (!periodoRef) throw new Error('Nenhum RREO recente encontrado.');
  console.log(`  RREO mais recente: ${anoRef}, bimestre ${periodoRef}`);

  // O layout do RREO no SICONFI muda antes de 2018; começamos em 2019 para cobrir mandatos inteiros.
  const anos = [];
  for (let ano = ANO_INICIAL_ORCAMENTO; ano <= anoRef; ano++) {
    const velho = anterior.anos.find((a) => a.ano === ano);
    const item = { ano, completo: null, mesmoPeriodo: null };
    const tarefas = [];
    if (ano < anoRef || periodoRef === 6) tarefas.push(['completo', 6]);
    if (periodoRef < 6) tarefas.push(['mesmoPeriodo', periodoRef]);
    for (const [campo, periodo] of tarefas) {
      try {
        item[campo] = await rreoPeriodo(ano, periodo);
      } catch (e) {
        avisar('orcamento', `RREO ${ano}/${periodo}: ${e.message}. Mantido o dado anterior.`);
        if (velho?.[campo]?.periodo === periodo) item[campo] = velho[campo];
      }
    }
    anos.push(item);
    console.log(`✓ RREO ${ano}`);
  }
  return {
    geradoEm: ctx.agora,
    referencia: { ano: anoRef, periodo: periodoRef, mesFinal: periodoRef * 2 },
    criterio: 'Despesas empenhadas (valor comprometido no orçamento do ano) e receitas realizadas da União, exceto operações intraorçamentárias.',
    fonte: {
      orgao: 'Secretaria do Tesouro Nacional',
      sistema: 'SICONFI',
      referencia: 'Relatório Resumido da Execução Orçamentária (RREO) da União, anexos 1 e 2',
      pagina: 'https://siconfi.tesouro.gov.br/siconfi/pages/public/consulta_finbra_rreo/finbra_rreo_list.jsf',
    },
    anos,
  };
}

// ---------------------------------------------------------------------------
// Programas instituídos por proposições do Poder Executivo (Câmara dos Deputados)
// ---------------------------------------------------------------------------

function classificar(ementa, palavras) {
  const texto = ementa.toLowerCase();
  return palavras.filter((p) => new RegExp(`(?<![\\p{L}])${p}(?![\\p{L}])`, 'u').test(texto));
}

async function coletarProgramas(ctx, mandatos) {
  const config = await lerJSON('config/programas.json');
  const anterior = await lerJSON('data/programas.json', { itens: [] });
  const anoHoje = Number(ctx.hoje.slice(0, 4));
  const criacao = new RegExp(
    `^(${config.verbos.join('|')})(?:,\\s*no âmbito [^,]+,)?\\s+(?:(?:o|os|a)\\s+)?(?:novo\\s+)?programas?(?![\\p{L}])`,
    'iu',
  );
  const disposicao = /^dispõe sobre (?:o|os)\s+programas?(?![\p{L}])/iu;
  const itens = [];
  const totais = [];
  let falhas = 0;
  for (let ano = config.anoInicial; ano <= anoHoje; ano++) {
    for (const tipo of config.tipos) {
      let lista;
      try {
        lista = await F.proposicoes({ siglaTipo: tipo, ano, autor: tipo === 'MPV' ? null : 'Poder Executivo' });
      } catch (e) {
        falhas++;
        avisar('programas', `Lista ${tipo} ${ano}: ${e.message}. Mantidos os itens anteriores desse ano.`);
        itens.push(...anterior.itens.filter((i) => i.ano === ano && i.siglaTipo === tipo));
        continue;
      }
      totais.push({ ano, tipo, total: lista.length });
      for (const p of lista) {
        const ementa = p.ementa.replace(/\s+/g, ' ').trim();
        const casou = ementa.match(criacao);
        const verbo = casou ? casou[1].toLowerCase() : disposicao.test(ementa) ? 'dispõe sobre' : null;
        if (!verbo) continue;
        const velho = anterior.itens.find((i) => i.id === p.id);
        let detalhe = null;
        try {
          detalhe = await F.detalheProposicao(p.id);
        } catch (e) {
          avisar('programas', `Detalhe da proposição ${p.id}: ${e.message}`);
        }
        const dataApresentacao = detalhe?.dataApresentacao?.slice(0, 10) ?? velho?.dataApresentacao ?? `${ano}-01-01`;
        const palavras = classificar(ementa, config.palavrasSociais);
        const revisao = config.revisoes[String(p.id)];
        itens.push({
          id: p.id,
          siglaTipo: p.siglaTipo,
          numero: p.numero,
          ano: p.ano,
          ementa,
          acao: verbo,
          dataApresentacao,
          mandato: mandatoEm(dataApresentacao, mandatos)?.id ?? null,
          situacao:
            detalhe?.statusProposicao?.descricaoSituacao ??
            (detalhe?.statusProposicao?.descricaoTramitacao ? `Em tramitação (${detalhe.statusProposicao.descricaoTramitacao})` : null) ??
            velho?.situacao ??
            null,
          social: revisao ? revisao.social : palavras.length > 0,
          palavrasSociais: palavras,
          classificacao: revisao ? 'revisada' : 'automatica',
          notaRevisao: revisao?.nota ?? null,
          link: F.paginaProposicao(p.id),
          inteiroTeor: detalhe?.urlInteiroTeor ?? velho?.inteiroTeor ?? null,
        });
      }
    }
    console.log(`✓ Câmara ${ano}`);
  }
  if (falhas && !itens.length) throw new Error('Nenhuma lista da Câmara respondeu.');
  itens.sort((a, b) => (a.dataApresentacao < b.dataApresentacao ? 1 : -1));
  return {
    geradoEm: ctx.agora,
    criterio: config.nota,
    verbos: config.verbos,
    palavrasSociais: config.palavrasSociais,
    fonte: { orgao: 'Câmara dos Deputados', sistema: 'Dados Abertos da Câmara', url: 'https://dadosabertos.camara.leg.br/api/v2/proposicoes?siglaTipo=MPV' },
    totais,
    itens,
  };
}

// ---------------------------------------------------------------------------
// Notícias de fontes oficiais, com filtro político e conferência de números
// ---------------------------------------------------------------------------

// O servidor de notícias do IBGE recusa conexões de fora do Brasil, como as do GitHub Actions.
// Quando isso acontece, mantemos as notícias anteriores, registramos a falha e o navegador do leitor
// busca as do IBGE diretamente (ver assets/js/noticias-ao-vivo.js), com o mesmo filtro e a mesma conferência.
async function coletarNoticias(ctx, series) {
  const filtroConfig = await lerJSON('config/filtro-politico.json');
  const anterior = await lerJSON('data/noticias.json', { itens: [], excluidos: [], fontes: [] });
  const brutas = [];
  const fontes = [];
  for (const [nome, coletor, url] of [
    ['IBGE', F.noticiasIbge, F.URL_NOTICIAS_IBGE],
    ['BCB', () => F.notasBcb(25), null],
  ]) {
    const ultimoSucessoAntes = anterior.fontes?.find((f) => f.fonte === nome)?.ultimoSucesso ?? null;
    try {
      const lista = await coletor();
      brutas.push(...lista);
      fontes.push({ fonte: nome, ok: true, itens: lista.length, ultimoSucesso: ctx.agora, url });
    } catch (e) {
      fontes.push({ fonte: nome, ok: false, erro: String(e.message), ultimoSucesso: ultimoSucessoAntes, url });
      avisar('noticias', `${nome}: ${e.message}. Mantidas as notícias anteriores dessa fonte.`);
      brutas.push(...anterior.itens.filter((i) => i.fonte === nome));
    }
  }
  const { itens, excluidos } = triarNoticias(brutas, series, filtroConfig);
  return {
    geradoEm: ctx.agora,
    criterio:
      'Somente comunicados publicados diretamente pelo IBGE e pelo Banco Central. Itens com termos político-partidários são retirados e listados com o termo encontrado.',
    fontes,
    itens: itens.slice(0, 45),
    excluidos,
  };
}

// ---------------------------------------------------------------------------
// Câmbio: histórico diário oficial (PTAX) das principais moedas. A cotação do dia é buscada
// ao vivo pelo navegador do leitor (assets/js/cambio.js); aqui fica a série verificada para comparações.
// ---------------------------------------------------------------------------

const MOEDAS_PTAX = [
  ['USD', 'Dólar americano'],
  ['EUR', 'Euro'],
  ['GBP', 'Libra esterlina'],
  ['JPY', 'Iene japonês'],
  ['CHF', 'Franco suíço'],
  ['CAD', 'Dólar canadense'],
];

async function coletarCambio(ctx) {
  const anterior = await lerJSON('data/cambio.json', { moedas: [] });
  const inicio = new Date(Date.parse(ctx.hoje) - 400 * 864e5).toISOString().slice(0, 10);
  const moedas = [];
  for (const [codigo, nome] of MOEDAS_PTAX) {
    try {
      const r = await F.ptaxPeriodo(codigo, inicio, ctx.hoje);
      if (!r.pontos.length || r.pontos.some(([, v]) => !(v > 0))) throw new Error('série vazia ou com valor inválido');
      // Fechamento mais de 5% longe do dia útil anterior é raro o bastante para ser conferido antes de confiar nele.
      const [penultimo, ultimo] = r.pontos.slice(-2);
      const salto = penultimo ? (ultimo[1] / penultimo[1] - 1) * 100 : 0;
      if (Math.abs(salto) > 5) {
        avisar('cambio', `PTAX ${codigo}: o fechamento de ${ultimo[0]} ficou ${salto.toFixed(1)}% longe do dia útil anterior. Variação atípica; conferir no Banco Central.`);
      }
      moedas.push({ codigo, nome, pontos: r.pontos, url: r.url });
    } catch (e) {
      avisar('cambio', `PTAX ${codigo}: ${e.message}. Mantida a série anterior.`);
      const velha = anterior.moedas.find((m) => m.codigo === codigo);
      if (velha) moedas.push(velha);
    }
  }
  console.log(`✓ câmbio: ${moedas.length} moedas, até ${moedas[0]?.pontos.at(-1)?.[0] ?? '—'}`);
  return {
    geradoEm: ctx.agora,
    fonte: {
      orgao: 'Banco Central do Brasil',
      sistema: 'PTAX (Olinda)',
      nota: 'Taxa de venda no fechamento de cada dia útil, calculada pelo Banco Central a partir das cotações do mercado.',
      pagina: 'https://www.bcb.gov.br/estabilidadefinanceira/historicocotacoes',
    },
    moedas,
  };
}

// ---------------------------------------------------------------------------
// Diário de atualizações: o que mudou desde a última coleta
// ---------------------------------------------------------------------------

function atualizarDiario(diario, ctx, anteriores, series, orcamento, anteriorOrcamento, programas, anteriorProgramas, extras = []) {
  const novas = [...extras];
  const primeiraVez = !Object.keys(anteriores || {}).length;
  for (const s of Object.values(series)) {
    if (s.status === 'falha') continue;
    const velho = anteriores?.[s.id]?.ultimo;
    if (primeiraVez || !velho) {
      novas.push({ tipo: 'registro', serie: s.id, periodo: s.ultimo.periodo, valor: s.ultimo.valor });
    } else if (velho.periodo !== s.ultimo.periodo) {
      novas.push({ tipo: 'novo', serie: s.id, periodo: s.ultimo.periodo, valor: s.ultimo.valor, anterior: velho });
    } else if (Math.abs(velho.valor - s.ultimo.valor) > 1e-9) {
      novas.push({ tipo: 'revisao', serie: s.id, periodo: s.ultimo.periodo, valor: s.ultimo.valor, anterior: velho });
    }
  }
  const ref = orcamento?.referencia;
  const refVelha = anteriorOrcamento?.referencia;
  if (ref && (!refVelha || refVelha.ano !== ref.ano || refVelha.periodo !== ref.periodo)) {
    novas.push({ tipo: primeiraVez ? 'registro' : 'novo', serie: 'orcamento', periodo: `${ref.ano}-${String(ref.mesFinal).padStart(2, '0')}`, valor: null });
  }
  if (programas && anteriorProgramas?.itens?.length) {
    const ids = new Set(anteriorProgramas.itens.map((i) => i.id));
    for (const p of programas.itens.filter((i) => !ids.has(i.id))) {
      novas.push({ tipo: 'programa', serie: 'programas', periodo: p.dataApresentacao, valor: null, programa: { id: p.id, rotulo: `${p.siglaTipo} ${p.numero}/${p.ano}`, ementa: p.ementa } });
    }
  }
  const entradas = [...novas.map((n) => ({ em: ctx.hoje, ...n })), ...(diario.entradas || [])].slice(0, 400);
  return { atualizadoEm: ctx.agora, entradas };
}

// ---------------------------------------------------------------------------

async function main() {
  const partes = process.argv.slice(2);
  const fazer = (p) => !partes.length || partes.includes(p);
  const agora = new Date();
  const ctx = { agora: agora.toISOString(), hoje: hojeBrasilia(agora), anoInicial: 2015 };
  const { mandatos } = await lerJSON('config/mandatos.json');
  const diario = await lerJSON('data/diario.json', { entradas: [] });
  const historicoExecucoes = (await lerJSON('data/execucao.json', { historico: [] })).historico || [];

  let indicadores = null;
  let anterioresSeries = null;
  if (fazer('series')) {
    const r = await coletarSeries(ctx);
    anterioresSeries = r.anterior.series;
    delete r.anterior;
    indicadores = r;
    await gravarJSON('data/indicadores.json', indicadores);
  } else {
    indicadores = await lerJSON('data/indicadores.json');
    ctx.anoInicial = 2015;
  }

  let orcamento = null;
  const anteriorOrcamento = await lerJSON('data/orcamento.json', null);
  if (fazer('orcamento')) {
    try {
      orcamento = await coletarOrcamento(ctx);
      await gravarJSON('data/orcamento.json', orcamento);
    } catch (e) {
      avisar('orcamento', `Coleta do RREO falhou (${e.message}). Mantido o arquivo anterior.`);
    }
  }

  let programas = null;
  const anteriorProgramas = await lerJSON('data/programas.json', null);
  if (fazer('programas')) {
    try {
      programas = await coletarProgramas(ctx, mandatos);
      await gravarJSON('data/programas.json', programas);
    } catch (e) {
      avisar('programas', `Coleta da Câmara falhou (${e.message}). Mantido o arquivo anterior.`);
    }
  }

  if (fazer('noticias')) {
    const noticias = await coletarNoticias(ctx, indicadores.series);
    await gravarJSON('data/noticias.json', noticias);
    console.log(`✓ notícias: ${noticias.itens.length} publicadas, ${noticias.excluidos.length} excluídas pelo filtro`);
  }

  if (fazer('imprensa')) {
    try {
      const anterior = await lerJSON('data/imprensa.json', null);
      const config = await lerJSON('config/imprensa.json');
      const filtro = await lerJSON('config/filtro-politico.json');
      const imprensa = await coletarImprensa(ctx, anterior, avisar, config, filtro, indicadores.series);
      if (imprensa) await gravarJSON('data/imprensa.json', imprensa);
    } catch (e) {
      avisar('imprensa', `Comparação da imprensa falhou (${e.message}). Mantido o arquivo anterior.`);
    }
  }

  if (fazer('cambio')) {
    try {
      await gravarJSON('data/cambio.json', await coletarCambio(ctx));
    } catch (e) {
      avisar('cambio', `Coleta do câmbio falhou (${e.message}). Mantido o arquivo anterior.`);
    }
  }

  const extrasTributos = [];
  if (fazer('tributos')) {
    try {
      const anteriorTributos = await lerJSON('data/tributos.json', null);
      const config = await lerJSON('config/tributos.json');
      const tributos = await coletarTributos(ctx, anteriorTributos, avisar, config);
      await gravarJSON('data/tributos.json', tributos);
      const antes = anteriorTributos?.receita?.atualizadoAte;
      if (tributos.receita?.atualizadoAte && tributos.receita.atualizadoAte !== antes) {
        extrasTributos.push({ tipo: antes ? 'novo' : 'registro', serie: 'tributos', periodo: tributos.receita.atualizadoAte, valor: null });
      }
    } catch (e) {
      avisar('tributos', `Coleta de tributos falhou (${e.message}). Mantido o arquivo anterior.`);
    }
  }

  // Segurança: o Sinesp entra na coleta diária; o Disque 100 (arquivos de vários GB) só quando pedido,
  // pelo fluxo semanal próprio (node scripts/atualizar.mjs disque100).
  const extrasDiario = [...extrasTributos];
  if (fazer('seguranca') || partes.includes('disque100')) {
    try {
      const anterior = await lerJSON('data/seguranca.json', null);
      if (fazer('seguranca')) for (const a of await coletarSinesp(ctx)) avisar('seguranca', a);
      if (partes.includes('disque100')) for (const a of await coletarDisque100(ctx)) avisar('disque100', a);
      const seg = await montarSeguranca(ctx);
      for (const a of seg.avisos || []) avisar('seguranca', a);
      for (const [fonte, bloco] of [['sinesp', seg.sinesp], ['disque100', seg.disque100]]) {
        const antes = anterior?.[fonte]?.atualizadoAte;
        if (bloco?.atualizadoAte && bloco.atualizadoAte !== antes) {
          extrasDiario.push({ tipo: antes ? 'novo' : 'registro', serie: fonte, periodo: bloco.atualizadoAte, valor: null });
        }
      }
      console.log(`✓ segurança: Sinesp até ${seg.sinesp?.atualizadoAte ?? '—'}, Disque 100 até ${seg.disque100?.atualizadoAte ?? '—'}`);
    } catch (e) {
      avisar('seguranca', `Coleta de segurança falhou (${e.message}). Mantidos os dados anteriores.`);
    }
  }

  if (anterioresSeries || extrasDiario.length) {
    await gravarJSON(
      'data/diario.json',
      anterioresSeries
        ? atualizarDiario(diario, ctx, anterioresSeries, indicadores.series, orcamento, anteriorOrcamento, programas, anteriorProgramas, extrasDiario)
        : { atualizadoEm: ctx.agora, entradas: [...extrasDiario.map((n) => ({ em: ctx.hoje, ...n })), ...(diario.entradas || [])].slice(0, 400) },
    );
  }

  // Uma tentativa que falhou e deu certo na repetição não é falha: conta como repetição.
  const fim = new Date();
  const respondidas = new Set(registro.filter((r) => r.ok).map((r) => r.url));
  const semResposta = new Set(registro.filter((r) => !r.ok && !respondidas.has(r.url)).map((r) => r.url));
  const porHost = {};
  for (const r of registro) {
    const host = new URL(r.url).host;
    porHost[host] ??= { host, chamadas: 0, falhas: 0, repeticoes: 0, ms: 0 };
    porHost[host].chamadas++;
    porHost[host].ms += r.ms;
    if (!r.ok) porHost[host][respondidas.has(r.url) ? 'repeticoes' : 'falhas']++;
  }
  const contagem = {};
  for (const s of Object.values(indicadores.series)) contagem[s.status] = (contagem[s.status] || 0) + 1;
  const resumo = {
    inicio: ctx.agora,
    fim: fim.toISOString(),
    segundos: Math.round((fim - agora) / 1000),
    partes: partes.length ? partes : ['series', 'orcamento', 'programas', 'noticias', 'imprensa', 'cambio', 'tributos', 'seguranca'],
    chamadas: registro.length,
    falhas: semResposta.size,
    repeticoes: registro.filter((r) => !r.ok && respondidas.has(r.url)).length,
    status: contagem,
    avisos: avisos.length,
  };
  await gravarJSON('data/execucao.json', {
    ...resumo,
    fontes: Object.values(porHost),
    avisos,
    historico: [resumo, ...historicoExecucoes].slice(0, 60).map(({ inicio, segundos, chamadas, falhas, status, avisos: a }) => ({ inicio, segundos, chamadas, falhas, status, avisos: a })),
  });

  console.log(`\nConcluído em ${resumo.segundos}s: ${resumo.chamadas} chamadas, ${resumo.falhas} sem resposta, ${resumo.repeticoes} repetidas, ${avisos.length} avisos`);
  const ok = Object.values(indicadores.series).some((s) => s.status !== 'falha');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
