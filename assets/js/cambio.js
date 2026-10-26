// Câmbio ao vivo. Duas fontes, sempre identificadas:
// - oficial: PTAX do Banco Central (boletins das 10h, 11h, 12h e 13h e o fechamento), consultada a cada 5 minutos;
// - mercado: cotação em tempo real de um serviço privado (AwesomeAPI), consultada a cada minuto
//   e comparada com a oficial. O histórico de 12 meses vem da coleta diária (data/cambio.json).
// As consultas param quando a aba fica em segundo plano.

import * as N from './nucleo.js';
import { $, h, alternador, chipTendencia } from './dom.js';
import { graficoLinhas, tabela, botaoTabela } from './graficos.js';

const MOEDAS = [
  { codigo: 'USD', nome: 'Dólar americano', ptax: true, por: 1 },
  { codigo: 'EUR', nome: 'Euro', ptax: true, por: 1 },
  { codigo: 'GBP', nome: 'Libra esterlina', ptax: true, por: 1 },
  { codigo: 'ARS', nome: 'Peso argentino', ptax: false, por: 1000, unidade: 'pesos' },
  { codigo: 'CNY', nome: 'Yuan chinês', ptax: false, por: 1 },
  { codigo: 'JPY', nome: 'Iene japonês', ptax: true, por: 100, unidade: 'ienes' },
  { codigo: 'CHF', nome: 'Franco suíço', ptax: true, por: 1 },
  { codigo: 'CAD', nome: 'Dólar canadense', ptax: true, por: 1 },
];

// EUR-USD entra só para a conferência cruzada: dólar em reais = euro em reais ÷ dólares por euro.
const URL_MERCADO = `https://economia.awesomeapi.com.br/json/last/${MOEDAS.map((m) => `${m.codigo}-BRL`).join(',')},EUR-USD`;
const urlMercadoHistorico = (codigo) => `https://economia.awesomeapi.com.br/json/daily/${codigo}-BRL/365`;
const urlPtaxDia = (moeda, iso) => {
  const [a, m, d] = iso.split('-');
  return (
    `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaDia(moeda=@moeda,dataCotacao=@dataCotacao)` +
    `?@moeda='${moeda}'&@dataCotacao='${m}-${d}-${a}'&$format=json`
  );
};

const LIMITE_DIFERENCA = 3; // % entre mercado e oficial a partir do qual o site avisa
// Variação num só dia a partir da qual o número é tratado como atípico. O real raramente passa de 5% num dia
// (as maiores quedas, em 1999, 2008 e 2020, ficaram entre 6% e 9%); acima disso, a primeira hipótese é erro na fonte.
const LIMITE_DIA = 5;
const LIMITE_CRUZADO = 2; // % entre o dólar cotado e o calculado pelo euro

const estado = {
  moeda: 'USD',
  mercado: {},
  eurUsd: null,
  ptaxHoje: {},
  historico: {},
  atualizadoMercado: null,
  atualizadoPtax: null,
  erroMercado: null,
  erroPtax: null,
};

let D;
let relogioMercado;
let relogioPtax;

const reais = (v, casas = 4) => `R$ ${N.formatarNumero(v, casas)}`;
const pct = (v) => `${v > 0 ? '+' : ''}${N.formatarNumero(v, 1)}%`;
const horaBR = (d) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Sao_Paulo' }).format(d);

async function json(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ---------- Coleta ao vivo ----------

async function atualizarMercado() {
  try {
    const dados = await json(URL_MERCADO);
    for (const m of MOEDAS) {
      const q = dados[`${m.codigo}BRL`];
      if (q && Number(q.bid) > 0) {
        estado.mercado[m.codigo] = { valor: Number(q.bid), variacaoDia: Number(q.pctChange), quando: q.create_date };
      }
    }
    estado.eurUsd = Number(dados.EURUSD?.bid) > 0 ? Number(dados.EURUSD.bid) : null;
    estado.atualizadoMercado = new Date();
    estado.erroMercado = null;
  } catch (e) {
    estado.erroMercado = e.message;
  }
}

async function atualizarPtax() {
  const hoje = N.hojeBrasilia();
  const resultados = await Promise.allSettled(
    MOEDAS.filter((m) => m.ptax).map(async (m) => {
      const r = await json(urlPtaxDia(m.codigo, hoje));
      const ultimo = r.value[r.value.length - 1];
      if (ultimo) estado.ptaxHoje[m.codigo] = { valor: ultimo.cotacaoVenda, quando: ultimo.dataHoraCotacao, tipo: ultimo.tipoBoletim };
    }),
  );
  estado.erroPtax = resultados.every((r) => r.status === 'rejected') ? 'o Banco Central não respondeu' : null;
  estado.atualizadoPtax = new Date();
}

async function carregarHistoricoMercado(codigo) {
  if (estado.historico[codigo]) return;
  try {
    const dados = await json(urlMercadoHistorico(codigo));
    estado.historico[codigo] = dados
      .map((q) => [new Date(Number(q.timestamp) * 1000 - 3 * 3600e3).toISOString().slice(0, 10), Number(q.bid)])
      .filter(([, v]) => v > 0)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  } catch {
    estado.historico[codigo] = [];
  }
}

// ---------- Valores derivados ----------

function oficial(m) {
  const hoje = estado.ptaxHoje[m.codigo];
  if (hoje) return { valor: hoje.valor, quando: hoje.quando, tipo: hoje.tipo, aoVivo: true };
  const pts = estado.historico[m.codigo];
  const ult = m.ptax && pts?.length ? pts[pts.length - 1] : null;
  return ult ? { valor: ult[1], quando: ult[0], tipo: 'Fechamento', aoVivo: false } : null;
}

function valorHaUmAno(m) {
  const pts = estado.historico[m.codigo];
  if (!pts?.length) return null;
  const alvo = Date.parse(pts[pts.length - 1][0]) - 365 * 864e5;
  return [...pts].reverse().find(([d]) => Date.parse(d) <= alvo) ?? null;
}

// Último fechamento oficial anterior a hoje (o histórico de PTAX vem da coleta diária).
function fechamentoAnterior(m) {
  const pts = m.ptax ? estado.historico[m.codigo] : null;
  const hoje = N.hojeBrasilia();
  return pts ? [...pts].reverse().find(([d]) => d < hoje) ?? null : null;
}

const foraDoComum = (v) => v != null && Math.abs(v) > LIMITE_DIA;

function linhaDaMoeda(m) {
  const of = oficial(m);
  const mk = estado.mercado[m.codigo];
  const agora = mk?.valor ?? of?.valor;
  const antes = valorHaUmAno(m);
  const doze = agora && antes ? (agora / antes[1] - 1) * 100 : null;
  const diferenca = of && mk ? (mk.valor / of.valor - 1) * 100 : null;
  const fech = of?.aoVivo ? fechamentoAnterior(m) : null;
  const oficialDia = fech ? (of.valor / fech[1] - 1) * 100 : null;
  return {
    m, of, mk, agora, antes, doze, real12: doze == null ? null : (antes[1] / agora - 1) * 100, diferenca,
    oficialDia,
    mercadoAtipico: foraDoComum(mk?.variacaoDia),
    oficialAtipico: foraDoComum(oficialDia),
  };
}

// Motivos para não confiar ainda no número do dólar. Cada um compara fontes ou dias diferentes entre si.
function alertasDolar(l) {
  const alertas = [];
  if (l.mercadoAtipico) alertas.push(`a cotação de mercado mudou ${pct(l.mk.variacaoDia)} num só dia, o que quase nunca acontece`);
  if (l.oficialAtipico) alertas.push(`o boletim do Banco Central está ${pct(l.oficialDia)} longe do último fechamento, o que quase nunca acontece`);
  if (l.diferenca != null && Math.abs(l.diferenca) > LIMITE_DIFERENCA) alertas.push(`mercado e Banco Central discordam em ${pct(l.diferenca)}`);
  const cruzado = dolarPeloEuro();
  if (cruzado && l.agora && Math.abs((l.agora / cruzado - 1) * 100) > LIMITE_CRUZADO) {
    alertas.push(`o dólar calculado pelo euro (${reais(cruzado, 4)}) não confirma o valor em destaque`);
  }
  return alertas;
}

const dolarPeloEuro = () => (estado.mercado.EUR && estado.eurUsd ? estado.mercado.EUR.valor / estado.eurUsd : null);

const precoPor = (m, v, casas = 4) => (v == null ? '—' : reais(v * m.por, m.por > 1 ? 2 : casas));
const sufixoPor = (m) => (m.por > 1 ? ` por ${N.formatarNumero(m.por, 0)} ${m.unidade}` : '');
const quandoTexto = (q) => {
  if (!q) return '';
  const [data, hora] = q.split(' ');
  return `${N.rotuloPeriodo(data, 'diaria')}${hora ? ` às ${hora.slice(0, 5)}` : ''}`;
};

// ---------- Desenho ----------

function alertaDolar(l) {
  const alertas = alertasDolar(l);
  if (!alertas.length) return null;
  return h('div', { class: 'cambio__alerta', role: 'note' },
    h('p', {}, h('strong', { texto: 'Número ainda não confirmado. ' }), `Neste momento ${alertas.join('; ')}. Pode ser erro de uma das fontes: espere a próxima consulta ou confira no site do Banco Central antes de usar este valor.`),
  );
}

function destaqueDolar() {
  const usd = MOEDAS[0];
  const l = linhaDaMoeda(usd);
  const tDia = l.mk ? { direcao: l.mk.variacaoDia > 0 ? 'sobe' : l.mk.variacaoDia < 0 ? 'desce' : 'igual', tom: 'neutro' } : null;
  return h('div', { class: 'cambio__destaque' },
    h('div', {},
      h('p', { class: 'cambio__rotulo', texto: 'Um dólar custa' }),
      h('p', { class: 'cambio__valor', texto: l.agora ? reais(l.agora, 4) : '—' }),
      l.mk
        ? h('p', { class: 'cambio__sub' }, `Mercado, ${quandoTexto(l.mk.quando)}. `, chipTendencia(tDia, `${pct(l.mk.variacaoDia)} no dia`))
        : h('p', { class: 'cambio__sub', texto: 'Cotação de mercado indisponível no momento.' }),
    ),
    h('dl', { class: 'fatos' },
      h('div', {}, h('dt', { texto: `Oficial do Banco Central (${l.of?.aoVivo ? `boletim ${l.of.tipo.toLowerCase()}` : 'último fechamento'})` }), h('dd', { texto: l.of ? reais(l.of.valor, 4) : '—' })),
      h('div', {}, h('dt', { texto: 'Diferença entre mercado e oficial' }), h('dd', { texto: l.diferenca == null ? '—' : pct(l.diferenca) })),
      h('div', {}, h('dt', { texto: 'Conferência: dólar calculado pelo euro (mercado)' }), h('dd', { texto: dolarPeloEuro() ? reais(dolarPeloEuro(), 4) : '—' })),
      h('div', {}, h('dt', { texto: 'Há um ano (oficial)' }), h('dd', { texto: l.antes ? reais(l.antes[1], 4) : '—' })),
      h('div', {}, h('dt', { texto: 'O real frente ao dólar em 12 meses' }), h('dd', { texto: l.real12 == null ? '—' : `${l.real12 >= 0 ? 'ganhou' : 'perdeu'} ${N.formatarNumero(Math.abs(l.real12), 1)}%` })),
    ),
  );
}

function tabelaMoedas() {
  const linhas = MOEDAS.map((m) => {
    const l = linhaDaMoeda(m);
    const aviso = l.diferenca != null && Math.abs(l.diferenca) > LIMITE_DIFERENCA ? ' (verificar)' : '';
    return [
      `${m.nome} (${m.codigo})${sufixoPor(m)}`,
      m.ptax ? `${precoPor(m, l.of?.valor)}${l.oficialAtipico ? ` (atípico: ${pct(l.oficialDia)} no dia)` : ''}` : 'sem PTAX',
      precoPor(m, l.mk?.valor),
      l.mk ? `${pct(l.mk.variacaoDia)}${l.mercadoAtipico ? ' (atípico)' : ''}` : '—',
      l.doze == null ? '—' : pct(l.doze),
      l.real12 == null ? '—' : `${l.real12 >= 0 ? 'ganhou' : 'perdeu'} ${N.formatarNumero(Math.abs(l.real12), 1)}%`,
      l.diferenca == null ? '—' : `${pct(l.diferenca)}${aviso}`,
    ];
  });
  return tabela(['Moeda', 'Oficial (BC)', 'Mercado agora', 'No dia', 'Moeda em 12 meses', 'O real em 12 meses', 'Mercado × oficial'], linhas, 'Cotações das principais moedas em reais');
}

function graficoMoeda(alvo) {
  const m = MOEDAS.find((x) => x.codigo === estado.moeda);
  const pts = estado.historico[m.codigo] || [];
  const dia = (iso) => Math.round(Date.parse(iso) / 864e5);
  graficoLinhas(alvo, {
    titulo: `${m.nome} em reais nos últimos 12 meses`,
    series: [{ nome: m.nome, cor: 'var(--serie-1)', pontos: pts.map(([d, v]) => [dia(d), v * m.por]) }],
    altura: 260,
    area: false,
    vazio: 'Histórico indisponível no momento.',
    marcasX: (xMin, xMax, largura) => {
      const marcas = [];
      const passo = largura < 520 ? 3 : 2;
      const ini = new Date(xMin * 864e5);
      for (let k = 1; k <= 13; k += passo) {
        const d = new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + k, 1));
        const x = Math.round(d.getTime() / 864e5);
        if (x <= xMax) marcas.push({ x, rotulo: `${N.MESES_CURTOS[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}` });
      }
      return marcas;
    },
    formatoEixo: (v) => N.formatarNumero(v, v < 10 ? 2 : 1),
    formatoRotulo: (v) => reais(v, m.por > 1 ? 2 : 4),
    formatoDica: (v) => `${reais(v, m.por > 1 ? 2 : 4)}${sufixoPor(m)}`,
    rotuloX: (x) => N.rotuloPeriodo(new Date(x * 864e5).toISOString().slice(0, 10), 'diaria'),
  });
}

// O painel é montado uma vez; a cada consulta só o status, o destaque e a tabela são trocados,
// e o gráfico só é redesenhado quando o leitor escolhe outra moeda (sem piscar a cada minuto).
const partes = {};

function montarEstrutura() {
  const alvo = $('painel-cambio');
  if (!alvo) return false;
  Object.assign(partes, {
    status: h('div', { class: 'cambio__status', 'aria-live': 'polite' }),
    destaque: h('div'),
    alerta: h('div'),
    tabela: h('div'),
    controles: h('div', { class: 'controles', style: 'margin:28px 0 8px' }),
    titulo: h('h4', { class: 'subtitulo', style: 'font-size:var(--texto-m)' }),
    grafico: h('div'),
    falhas: h('div', { class: 'notas-painel' }),
    notaMoeda: h('div', { class: 'notas-painel' }),
    rodape: h('div', { class: 'painel__rodape' }),
  });
  alvo.replaceChildren(
    partes.status,
    partes.destaque,
    partes.alerta,
    h('h3', { class: 'subtitulo', style: 'margin-top:28px', texto: 'Principais moedas' }),
    h('p', { class: 'legenda-painel', texto: 'Quanto custa cada moeda em reais. Iene e peso argentino aparecem por 100 e por 1.000 unidades para facilitar a leitura. A coluna "Mercado × oficial" compara as duas fontes; diferenças acima de 3% são marcadas para verificação, e variações acima de 5% num só dia aparecem como atípicas.' }),
    partes.tabela,
    partes.controles,
    partes.titulo,
    partes.grafico,
    partes.falhas,
    h('div', { class: 'notas-painel' },
      h('p', { texto: 'Oficial: taxa PTAX de venda do Banco Central, que publica boletins às 10h, 11h, 12h e 13h e o fechamento do dia. Fora do horário e nos fins de semana vale o último fechamento.' }),
      h('p', { texto: 'Mercado: cotação em tempo real de um serviço privado gratuito (AwesomeAPI), que agrega preços do mercado de câmbio. Não é fonte oficial; por isso aparece sempre ao lado da oficial e é comparada com ela.' }),
      h('p', { texto: 'Conferência cruzada: o dólar também é calculado dividindo o euro em reais pela cotação do euro em dólares. Se esse cálculo, o mercado e o Banco Central não baterem, ou se a variação do dia passar de 5%, o painel avisa que o número ainda não está confirmado.' }),
    ),
    partes.notaMoeda,
    partes.rodape,
  );
  return true;
}

function atualizarValores() {
  if (!partes.status) return;
  const status = [
    estado.atualizadoMercado ? `Mercado consultado às ${horaBR(estado.atualizadoMercado)}` : 'Consultando o mercado…',
    estado.atualizadoPtax ? `oficial às ${horaBR(estado.atualizadoPtax)}` : null,
  ].filter(Boolean).join('; ');
  partes.status.replaceChildren(h('span', { class: 'cambio__pulso', 'aria-hidden': 'true' }), status);
  partes.destaque.replaceChildren(destaqueDolar());
  partes.alerta.replaceChildren(...[alertaDolar(linhaDaMoeda(MOEDAS[0]))].filter(Boolean));
  partes.tabela.replaceChildren(tabelaMoedas());
  partes.falhas.replaceChildren(
    ...[
      estado.erroMercado ? `A cotação de mercado não respondeu (${estado.erroMercado}); mostrando a oficial.` : null,
      estado.erroPtax ? 'O Banco Central não respondeu agora; a cotação oficial é a do último fechamento coletado.' : null,
    ].filter(Boolean).map((t) => h('p', { texto: t })),
  );
}

function trocarMoeda() {
  const m = MOEDAS.find((x) => x.codigo === estado.moeda);
  partes.controles.replaceChildren(
    alternador('Moeda do gráfico', MOEDAS.map((x) => [x.codigo, x.codigo]), estado.moeda, async (v) => {
      estado.moeda = v;
      if (!MOEDAS.find((x) => x.codigo === v).ptax) await carregarHistoricoMercado(v);
      trocarMoeda();
    }),
  );
  partes.titulo.textContent = `${m.nome} em reais nos últimos 12 meses${sufixoPor(m)}`;
  partes.notaMoeda.replaceChildren(
    ...(m.ptax ? [] : [h('p', { texto: `O Banco Central não publica PTAX do ${m.nome.toLowerCase()} no serviço de consulta usado aqui; o gráfico usa o histórico da cotação de mercado.` })]),
  );
  partes.rodape.replaceChildren(
    h('span', {}, 'Fontes: ',
      h('a', { href: 'https://www.bcb.gov.br/estabilidadefinanceira/historicocotacoes', target: '_blank', rel: 'noopener', texto: 'Banco Central (PTAX)' }),
      ' e ',
      h('a', { href: 'https://docs.awesomeapi.com.br/api-de-moedas', target: '_blank', rel: 'noopener', texto: 'AwesomeAPI (mercado)' }),
      '.'),
    botaoTabela(partes.grafico, () => tabela(['Data', 'Valor'], [...(estado.historico[m.codigo] || [])].reverse().slice(0, 60).map(([d, v]) => [N.rotuloPeriodo(d, 'diaria'), precoPor(m, v)]), `${m.nome} em reais`)),
  );
  graficoMoeda(partes.grafico);
}

function agendar() {
  clearInterval(relogioMercado);
  clearInterval(relogioPtax);
  if (document.visibilityState !== 'visible') return;
  relogioMercado = setInterval(async () => {
    await atualizarMercado();
    atualizarValores();
  }, 60e3);
  relogioPtax = setInterval(async () => {
    await atualizarPtax();
    atualizarValores();
  }, 5 * 60e3);
}

export async function renderCambio(dados) {
  D = dados;
  for (const m of D.cambio?.moedas || []) estado.historico[m.codigo] = m.pontos;
  if (!montarEstrutura()) return;
  atualizarValores();
  trocarMoeda();
  await Promise.all([atualizarMercado(), atualizarPtax()]);
  atualizarValores();
  agendar();
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      await Promise.all([atualizarMercado(), atualizarPtax()]);
      atualizarValores();
    }
    agendar();
  });
}
