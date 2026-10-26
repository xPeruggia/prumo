// Monta o site a partir dos arquivos em data/, gerados pela coleta diária.
// Todo texto vindo das fontes é inserido com textContent, nunca como HTML.

import * as N from './nucleo.js';
import { graficoLinhas, graficoBarras, graficoColunas, faisca, tabela, botaoTabela } from './graficos.js';
import { conferirNoNavegador, carimbo } from './conferir.js';
import { $, h, icone, selo, alternador, chipTendencia } from './dom.js';
import { renderSeguranca, painelSegurancaMandatos } from './seguranca.js';
import { coletaDoIbgeFalhou, buscarIbgeNoNavegador } from './noticias-ao-vivo.js';

const NS = 'http://www.w3.org/2000/svg';

// ---------- Formatação ----------

const fmt = (s, v, op) => N.formatarValor(v, s.unidade, s.casas, op);
const rotulo = (s, periodo, op) => N.rotuloPeriodo(periodo, s.periodicidade === 'diaria' ? 'mensal' : s.periodicidade, op);
const reais = (v, op) => N.formatarReais(v, op);
const reaisCheios = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);
// Datas com hora são convertidas para o dia de Brasília antes de exibir (uma coleta às 23h não pode virar "amanhã").
const dataCurta = (iso) => N.rotuloPeriodo(iso.length > 10 ? N.hojeBrasilia(new Date(iso)) : iso, 'diaria');
const eixo = (v) => N.formatarNumero(v, Number.isInteger(v) ? 0 : 1);
const horaBrasilia = (iso) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
const numeroProposicao = (n) => new Intl.NumberFormat('pt-BR').format(n);

function valorPartido(s, v) {
  switch (s.unidade) {
    case '% a.a.': return [`${N.formatarNumero(v, s.casas)}%`, 'ao ano'];
    case '% do PIB': return [`${N.formatarNumero(v, s.casas)}%`, 'do PIB'];
    default: return [fmt(s, v), null];
  }
}

const TAXAS_DE_VARIACAO = new Set(['ipcaMes', 'pibTri', 'pib4tri']);

// Variação sobre o período anterior (mês, trimestre ou, nas séries diárias, 30 dias), como texto e como tendência colorida.
function variacaoLinha(s) {
  if (s.periodicidade === 'diaria' && s.ultimosDiarios?.length) {
    const d = s.ultimosDiarios;
    const [dataFim, vFim] = d[d.length - 1];
    const alvo = Date.parse(dataFim) - 30 * 864e5;
    const ref = [...d].reverse().find(([data]) => Date.parse(data) <= alvo) ?? d[0];
    const t = N.tendencia(ref[1], vFim, s.unidade, s.casas, s.sentido);
    return { tendencia: t, texto: t.direcao === 'igual' ? `sem mudança desde ${dataCurta(ref[0])}` : `${t.texto} desde ${dataCurta(ref[0])}` };
  }
  if (!s.anterior) return { tendencia: null, texto: '' };
  const t = N.tendencia(s.anterior.valor, s.ultimo.valor, s.unidade, s.casas, s.sentido);
  if (TAXAS_DE_VARIACAO.has(s.id)) return { tendencia: t, texto: `antes: ${fmt(s, s.anterior.valor)} em ${rotulo(s, s.anterior.periodo)}` };
  return { tendencia: t, texto: t.direcao === 'igual' ? `igual a ${rotulo(s, s.anterior.periodo)}` : `${t.texto} sobre ${rotulo(s, s.anterior.periodo)}` };
}

// Tendência do último ponto de uma série de gráfico ([[x, y]]) sobre o anterior.
function tendenciaDosPontos(pontos, unidade, casas, sentido) {
  if (pontos.length < 2) return null;
  return N.tendencia(pontos[pontos.length - 2][1], pontos[pontos.length - 1][1], unidade, casas, sentido);
}

function valorAtual(s) {
  return s.ultimoDiario ? { valor: s.ultimoDiario.valor, rotulo: dataCurta(s.ultimoDiario.data) } : { valor: s.ultimo.valor, rotulo: rotulo(s, s.ultimo.periodo) };
}

// ---------- Eixos de tempo ----------

function marcasAnos(xMin, xMax, largura) {
  const marcas = [];
  const meses = xMax - xMin;
  if (meses <= 36) {
    for (let x = Math.ceil(xMin / 6) * 6; x <= xMax; x += 6) {
      const p = N.periodoDeIndice(x);
      marcas.push({ x, rotulo: `${N.MESES_CURTOS[Number(p.slice(5)) - 1]}/${p.slice(2, 4)}` });
    }
    return marcas;
  }
  const anos = meses / 12;
  const passo = largura < 520 ? (anos > 8 ? 3 : 2) : anos > 9 ? 2 : 1;
  for (let ano = Math.ceil(xMin / 12); ano * 12 <= xMax; ano += passo) {
    marcas.push({ x: ano * 12, rotulo: largura < 420 ? `’${String(ano).slice(2)}` : String(ano) });
  }
  return marcas;
}

function faixasMandatos(mandatos) {
  return mandatos.map((m) => ({ rotulo: m.rotulo, de: N.indiceMes(m.inicio.slice(0, 7)), ate: N.indiceMes(m.fim.slice(0, 7)) }));
}

const paraIndices = (pontos) => pontos.filter(([p]) => p.length > 4).map(([p, v]) => [N.indiceMes(p), v]);

// ---------- Estado global ----------

const D = {};

async function carregar() {
  const ler = (c) => fetch(c, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [indicadores, orcamento, programas, noticias, diario, execucao, seguranca, mandatos, site] = await Promise.all([
    ler('data/indicadores.json'),
    ler('data/orcamento.json'),
    ler('data/programas.json'),
    ler('data/noticias.json'),
    ler('data/diario.json'),
    ler('data/execucao.json'),
    ler('data/seguranca.json'),
    ler('config/mandatos.json'),
    ler('config/site.json'),
  ]);
  Object.assign(D, { indicadores, orcamento, programas, noticias, diario, execucao, seguranca, mandatos, site });
  D.hoje = N.hojeBrasilia();
  return Boolean(indicadores && mandatos);
}

function falhaDeCarga() {
  $('titulo-boletim').textContent = 'Os dados não carregaram';
  $('boletim-lede').replaceChildren(
    h('span', {
      texto:
        'O navegador não conseguiu ler os arquivos da pasta data/. Se você abriu o index.html direto do computador, sirva a pasta com um servidor local (por exemplo, "python3 -m http.server" dentro dela) e abra o endereço indicado.',
    }),
  );
  $('boletim-lede').classList.add('erro-carga');
}

// ---------- Boletim ----------

function renderBoletim() {
  const { indicadores: I, execucao: E, mandatos: M } = D;
  const dia = N.hojeBrasilia(new Date(I.geradoEm));
  const extenso = N.dataPorExtenso(dia);
  $('boletim-semana').textContent = `Boletim de ${extenso.semana}`;
  $('titulo-boletim').textContent = extenso.texto;
  document.title = `Prumo — boletim de ${extenso.texto}`;

  const S = I.series;
  const partes = [];
  const forte = (t) => h('strong', { texto: t });
  if (S.ipca12m) partes.push('A inflação oficial acumulada em 12 meses está em ', forte(fmt(S.ipca12m, S.ipca12m.ultimo.valor)), ` (${rotulo(S.ipca12m, S.ipca12m.ultimo.periodo)}). `);
  const resto = [];
  if (S.selic) resto.push(['a Selic em ', forte(`${N.formatarNumero(valorAtual(S.selic).valor, 2)}% ao ano`)]);
  if (S.desemprego) resto.push(['o desemprego em ', forte(fmt(S.desemprego, S.desemprego.ultimo.valor)), ` (${rotulo(S.desemprego, S.desemprego.ultimo.periodo)})`]);
  if (S.dbgg) resto.push(['a dívida bruta do governo em ', forte(`${N.formatarNumero(S.dbgg.ultimo.valor, 1)}% do PIB`), ` (${rotulo(S.dbgg, S.dbgg.ultimo.periodo)})`]);
  resto.forEach((r, i) => {
    if (i === 0) r[0] = r[0][0].toUpperCase() + r[0].slice(1);
    partes.push(...r, i === resto.length - 1 ? '.' : i === resto.length - 2 ? ' e ' : ', ');
  });
  $('boletim-lede').replaceChildren(...partes);

  const [mA, mB] = D.mandatos.comparacao.map((id) => M.mandatos.find((m) => m.id === id));
  const faltam = N.diasAte(mB.inicio, D.hoje);
  const posse = N.dataPorExtenso(mB.inicio).texto;
  $('boletim-mandato').textContent =
    faltam > 0
      ? `Faltam ${faltam} dias para a posse do mandato ${mB.rotulo}, em ${posse}. A partir daí, cada indicador passa a ser comparado mês a mês com o mesmo ponto do mandato ${mA.rotulo}.`
      : `O mandato ${mB.rotulo} começou em ${posse}. O comparativo com o mandato ${mA.rotulo} usa sempre o mesmo mês de governo.`;

  // Conferência do dia
  const contagem = {};
  for (const s of Object.values(S)) contagem[s.status] = (contagem[s.status] || 0) + 1;
  const ordem = ['confere', 'fonte-unica', 'sem-conferencia', 'diverge', 'falha'];
  const temProblema = (contagem.diverge || 0) + (contagem.falha || 0) > 0;
  const [a, m, d] = dia.split('-');
  const dataCarimbo = `${d} ${N.MESES_CURTOS[Number(m) - 1].toUpperCase()} ${a}`;
  $('carimbo-dia').replaceChildren(carimbo({ data: dataCarimbo, diverge: Boolean(contagem.diverge) }));
  $('contagem-status').replaceChildren(
    ...ordem
      .filter((st) => contagem[st] || st === 'confere' || st === 'diverge' || st === 'falha')
      .map((st) => h('li', {}, icone(st), h('span', { texto: N.STATUS[st].rotulo }), h('b', { texto: String(contagem[st] || 0) }))),
  );
  if (E) {
    const servicos = E.fontes?.length ?? 0;
    const respostas = E.falhas ? `${E.falhas} ${E.falhas === 1 ? 'ficou' : 'ficaram'} sem resposta` : 'todas respondidas';
    $('coleta').textContent = `Coleta concluída às ${horaBrasilia(E.fim)} (horário de Brasília): ${E.chamadas} consultas a ${servicos} serviços oficiais, ${respostas}.${temProblema ? ' Veja os avisos em “Como verificamos”.' : ''}`;
  }

  $('conferir-tudo').addEventListener('click', async (ev) => {
    const botao = ev.currentTarget;
    const consultas = Object.values(S).flatMap((s) => (s.noNavegador || []).map((q) => ({ ...q, serie: s })));
    botao.disabled = true;
    botao.textContent = `Consultando ${consultas.length} séries nas APIs oficiais…`;
    const r = await conferirNoNavegador(consultas);
    botao.disabled = false;
    botao.textContent = 'Conferir de novo';
    const ok = r.filter((x) => x.ok === true).length;
    const diverge = r.filter((x) => x.ok === false);
    const semResposta = r.filter((x) => x.ok === null).length;
    const alvo = $('resultado-conferencia');
    alvo.replaceChildren(
      `${ok} de ${r.length} consultas feitas agora pelo seu navegador devolveram exatamente os números publicados aqui.`,
      diverge.length ? ` ${diverge.length} ${diverge.length === 1 ? 'diferiu' : 'diferiram'}: ${diverge.map((x) => x.serie.curto).join(', ')} (o órgão pode ter publicado um dado novo ou revisado depois da coleta).` : '',
      semResposta ? ` ${semResposta} não ${semResposta === 1 ? 'respondeu' : 'responderam'}.` : '',
    );
    $('carimbo-dia').replaceChildren(carimbo({ data: dataCarimbo, diverge: diverge.length > 0, batido: true }));
  });
}

// ---------- Indicadores ----------

function renderIndicadores() {
  const { series, temas } = D.indicadores;
  const grupos = temas.map((t) => {
    const lista = Object.values(series).filter((s) => s.tema === t.id);
    if (!lista.length) return null;
    return h(
      'section',
      { class: 'grupo', 'aria-label': t.nome },
      h('h3', { texto: t.nome }),
      h(
        'ul',
        {},
        lista.map((s) => {
          const atual = valorAtual(s);
          const [num, unidade] = valorPartido(s, atual.valor);
          const svg = document.createElementNS(NS, 'svg');
          svg.setAttribute('class', 'linha__faisca');
          faisca(svg, s.pontos.slice(-24));
          return h(
            'li',
            {},
            h(
              'button',
              { class: 'linha', type: 'button', onclick: () => abrirDetalhe(s.id), 'aria-label': `${s.nome}: ${fmt(s, atual.valor)}, ${atual.rotulo}. ${N.STATUS[s.status].rotulo}. Abrir detalhes.` },
              h('span', { class: 'linha__nome', texto: s.nome }),
              h('span', { class: 'linha__valor' }, num, unidade ? h('small', { texto: unidade }) : null),
              svg,
              h('span', { class: 'linha__periodo', texto: `${s.fonte.orgao === 'Banco Central do Brasil' ? 'Banco Central' : s.fonte.orgao}, ${atual.rotulo}` }),
              h('span', { class: 'linha__variacao' }, (() => {
                const v = variacaoLinha(s);
                return chipTendencia(v.tendencia, v.texto);
              })()),
              h('span', { class: 'linha__status' }, selo(s.status)),
            ),
          );
        }),
      ),
    );
  });
  $('registro').replaceChildren(...grupos.filter(Boolean));

  const F = D.indicadores.focus;
  if (F?.itens?.length) {
    const anos = [...new Set(F.itens.map((i) => i.ano))];
    const nomes = [...new Set(F.itens.map((i) => i.nome))];
    const painel = $('focus');
    painel.hidden = false;
    painel.style.marginTop = '32px';
    const valorFocus = (i) => (i.unidade === 'R$' ? `R$ ${N.formatarNumero(i.mediana, 2)}` : `${N.formatarNumero(i.mediana, 2)}%`);
    painel.replaceChildren(
      h('div', { class: 'painel__topo' },
        h('div', {},
          h('h3', { class: 'subtitulo', texto: 'O que o mercado espera' }),
          h('p', { class: 'legenda-painel', texto: `${F.nota} Pesquisa de ${dataCurta(F.dataPesquisa)}.` }),
        ),
      ),
      tabela(
        ['Indicador', ...anos.map(String)],
        nomes.map((nome) => [nome, ...anos.map((ano) => { const i = F.itens.find((x) => x.nome === nome && x.ano === ano); return i ? valorFocus(i) : '—'; })]),
        'Mediana das expectativas do relatório Focus',
      ),
      h('div', { class: 'painel__rodape' }, h('span', {}, 'Fonte: Banco Central do Brasil, Sistema de Expectativas de Mercado. ', h('a', { href: F.url, texto: 'Consulta usada' }))),
    );
  }
}

// ---------- Detalhe de um indicador ----------

function abrirDetalhe(id) {
  const s = D.indicadores.series[id];
  if (!s) return;
  const dlg = $('detalhe');
  const atual = valorAtual(s);
  const graf = h('div', { class: 'detalhe__grafico' });
  const faixas = faixasMandatos(D.mandatos.mandatos);
  const todos = paraIndices(s.pontos);
  let recorte = 'tudo';
  const desenhar = () => {
    const ultimo = todos[todos.length - 1][0];
    const corte = recorte === '5a' ? ultimo - 60 : recorte === '2a' ? ultimo - 24 : -Infinity;
    graficoLinhas(graf, {
      titulo: `${s.nome}, série histórica`,
      series: [{ nome: s.curto, cor: 'var(--serie-1)', pontos: todos.filter(([x]) => x >= corte), tendencia: tendenciaDosPontos(todos, s.unidade, s.casas, s.sentido) }],
      faixas,
      area: true,
      incluirZero: s.unidade === 'R$ mi',
      altura: 280,
      marcasX: marcasAnos,
      formatoEixo: (v) => (s.unidade === 'R$ mi' ? N.formatarReais(v * 1e6, { casas: 0 }).replace('R$ ', '') : eixo(v)),
      formatoRotulo: (v) => fmt(s, v, { compacto: true }),
      formatoDica: (v) => fmt(s, v),
      rotuloX: (x) => rotulo(s, N.periodoDeIndice(x)),
    });
  };
  const botaoRecorte = (valor, texto) =>
    h('button', {
      type: 'button',
      'aria-pressed': String(recorte === valor),
      texto,
      onclick: (e) => {
        recorte = valor;
        e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        desenhar();
      },
    });

  const c = s.conferencia;
  const fichaFonte = h('div', { class: 'ficha' },
    h('h4', { texto: 'Fonte principal' }),
    h('p', {}, h('b', { texto: s.fonte.orgao }), `, ${s.fonte.referencia.charAt(0).toLowerCase()}${s.fonte.referencia.slice(1)}.`),
    s.fonte.nomeOficial ? h('p', { texto: `Nome oficial: ${s.fonte.nomeOficial}.` }) : null,
    h('p', { texto: `Consultado em ${dataCurta(s.fonte.consultadoEm)} às ${horaBrasilia(s.fonte.consultadoEm)}.` }),
    h('p', { class: 'url' }, h('a', { href: s.fonte.url, target: '_blank', rel: 'noopener', texto: s.fonte.url })),
  );
  let fichaConferencia;
  if (!c) {
    fichaConferencia = h('div', { class: 'ficha' },
      h('h4', { texto: 'Segunda fonte' }),
      h('p', { texto: 'Não há outra fonte oficial que publique este número. Ele vem diretamente do órgão que o produz, e o link ao lado leva ao dado original.' }),
    );
  } else if (c.status === 'sem-conferencia') {
    fichaConferencia = h('div', { class: 'ficha' },
      h('h4', { texto: 'Segunda fonte' }),
      h('p', { texto: `A segunda fonte (${c.orgao}) não respondeu na coleta de hoje: ${c.erro}. A conferência será refeita amanhã.` }),
    );
  } else {
    fichaConferencia = h('div', { class: 'ficha' },
      h('h4', { texto: 'Segunda fonte' }),
      h('p', { texto: c.descricao }),
      h('p', {},
        selo(c.status),
        ` ${rotulo(s, c.periodo.length === 10 ? c.periodo.slice(0, 7) : c.periodo)}: ${fmt(s, c.valorPrimaria)} na fonte principal, ${fmt(s, c.valorConferencia)} na conferência.`,
        c.comparados > 1 ? ` ${c.conferidos} de ${c.comparados} períodos recentes conferem.` : '',
      ),
      c.defasagem ? h('p', { texto: c.defasagem }) : null,
      h('p', { class: 'url' }, h('a', { href: c.url, target: '_blank', rel: 'noopener', texto: c.url })),
    );
  }

  const resultado = h('div', { class: 'conferir-agora__resultado', 'aria-live': 'polite' });
  const botaoConferir = h('button', {
    class: 'botao',
    type: 'button',
    texto: 'Conferir agora',
    onclick: async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      b.textContent = 'Consultando…';
      const r = await conferirNoNavegador(s.noNavegador || []);
      b.disabled = false;
      b.textContent = 'Conferir de novo';
      const diverge = r.some((x) => x.ok === false);
      const tudoOk = r.length && r.every((x) => x.ok === true);
      const [a, m, d] = N.hojeBrasilia().split('-');
      resultado.replaceChildren(
        tudoOk || diverge ? carimbo({ data: `${d} ${N.MESES_CURTOS[Number(m) - 1].toUpperCase()} ${a}`, diverge, batido: true }) : h('span'),
        h('ul', {},
          r.map((x) =>
            h('li', {
              texto:
                x.ok === null
                  ? `${x.orgao} (${x.rotulo}): ${x.erro}.`
                  : `${x.orgao} (${x.rotulo}), ${x.periodo.length === 10 ? dataCurta(x.periodo) : rotulo(s, x.periodo)}: ${fmt(s, x.valorObtido)} — ${x.ok ? 'igual ao publicado aqui' : `diferente do publicado aqui (${fmt(s, x.valorEsperado)}); o órgão pode ter atualizado a série depois da nossa coleta`}.`,
            }),
          ),
        ),
      );
    },
  });

  const csv = () => {
    const linhas = [['periodo', 'valor'], ...s.pontos].map((l) => l.join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${linhas}`], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: `prumo-${s.id}.csv` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const corpoGrafico = h('div', {}, graf);
  dlg.replaceChildren(
    h('div', { class: 'detalhe__corpo' },
      h('div', { class: 'detalhe__topo' },
        h('h2', { class: 'detalhe__titulo', id: 'detalhe-titulo', texto: s.nome }),
        h('button', { class: 'detalhe__fechar', type: 'button', 'aria-label': 'Fechar', texto: '×', onclick: () => dlg.close() }),
      ),
      h('div', { class: 'detalhe__valor' },
        h('b', { texto: fmt(s, atual.valor) }),
        h('span', { texto: atual.rotulo }),
        (() => {
          const v = variacaoLinha(s);
          return v.texto ? chipTendencia(v.tendencia, v.texto) : null;
        })(),
        selo(s.status),
      ),
      h('p', { class: 'detalhe__descricao', texto: s.descricao }),
      s.notaTransformacao ? h('p', { class: 'detalhe__descricao', style: 'margin-top:8px', texto: s.notaTransformacao }) : null,
      s.status === 'falha' ? h('p', { class: 'erro-carga', style: 'margin-top:12px', texto: `A coleta de ${dataCurta(s.falha.em)} falhou (${s.falha.erro}). Mostramos o último dado válido.` }) : null,
      h('div', { class: 'controles', style: 'margin:22px 0 0' },
        h('div', { class: 'alternador', role: 'group', 'aria-label': 'Período do gráfico' }, botaoRecorte('tudo', 'Desde 2015'), botaoRecorte('5a', '5 anos'), botaoRecorte('2a', '24 meses')),
      ),
      corpoGrafico,
      h('div', { class: 'painel__rodape' },
        h('span', { texto: 'Faixas cinza: mandatos presidenciais. Use as setas do teclado para percorrer o gráfico.' }),
        h('span', {},
          botaoTabela(corpoGrafico, () => tabela(['Período', 'Valor'], [...s.pontos].reverse().map(([p, v]) => [rotulo(s, p), fmt(s, v)]), s.nome)),
          '  ',
          h('button', { class: 'link-tabela', type: 'button', texto: 'Baixar CSV', onclick: csv }),
        ),
      ),
      h('div', { class: 'fichas' }, fichaFonte, fichaConferencia),
      s.noNavegador?.length
        ? h('div', { class: 'conferir-agora' },
            h('p', { texto: 'Refaça a consulta na API oficial, a partir do seu navegador. A resposta vem direto do órgão, sem passar por este site.' }),
            botaoConferir,
            resultado,
          )
        : null,
    ),
  );
  if (!dlg.open) dlg.showModal();
  requestAnimationFrame(desenhar);
  history.replaceState(null, '', `#indicador=${id}`);
}

function prepararDialogo() {
  const dlg = $('detalhe');
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener('close', () => {
    if (location.hash.startsWith('#indicador=')) history.replaceState(null, '', '#indicadores');
  });
}

// ---------- Contas públicas ----------

let relogio;

function renderArrecadacao() {
  const O = D.orcamento;
  const alvo = $('arrecadacao');
  if (!O) {
    alvo.replaceChildren(h('p', { texto: 'Os dados do orçamento ainda não foram coletados.' }));
    return;
  }
  const ref = O.referencia;
  const doAno = (ano) => O.anos.find((a) => a.ano === ano);
  const dado = ref.periodo === 6 ? doAno(ref.ano).completo : doAno(ref.ano).mesmoPeriodo;
  const total = dado.receitaTributaria + dado.contribuicoes;
  const inicio = Date.UTC(ref.ano, 0, 1, 3);
  const fimPeriodo = Date.UTC(ref.ano, ref.mesFinal, 1, 3);
  const ritmo = total / (fimPeriodo - inicio);
  const anoAgora = Number(D.hoje.slice(0, 4));
  const inicioAgora = Date.UTC(anoAgora, 0, 1, 3);
  const estimar = () => (anoAgora === ref.ano ? total + ritmo * (Date.now() - fimPeriodo) : ritmo * (Date.now() - inicioAgora));

  const indice = D.indicadores.auxiliares?.ipcaIndice?.pontos;
  const anterior = doAno(ref.ano - 1)?.[ref.periodo === 6 ? 'completo' : 'mesmoPeriodo'];
  let comparacao = '—';
  if (anterior && indice) {
    const fA = N.fatorDeflacao(indice, ref.ano, ref.mesFinal);
    const fB = N.fatorDeflacao(indice, ref.ano - 1, ref.mesFinal);
    const real = ((total * fA.fator) / ((anterior.receitaTributaria + anterior.contribuicoes) * fB.fator) - 1) * 100;
    comparacao = `${real > 0 ? '+' : ''}${N.formatarNumero(real, 1)}%`;
  }
  const pop = D.indicadores.auxiliares?.populacao?.pontos;
  const popAno = pop?.find(([p]) => p === String(ref.ano)) ?? pop?.[pop.length - 1];
  const periodoTexto = ref.mesFinal === 12 ? `em ${ref.ano}` : `de janeiro a ${N.MESES[ref.mesFinal - 1]} de ${ref.ano}`;

  const contador = h('p', { class: 'contador', 'aria-live': 'off' });
  const atualizar = () => (contador.textContent = reaisCheios(estimar()));
  atualizar();
  clearInterval(relogio);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) relogio = setInterval(atualizar, 120);

  alvo.replaceChildren(
    h('div', { class: 'arrecadacao' },
      h('div', {},
        h('p', { class: 'contador-rotulo', texto: `Impostos e contribuições arrecadados pela União em ${anoAgora}, até este instante` }),
        contador,
        h('span', { class: 'selo-estimativa' }, icone('estimativa'), 'Estimativa calculada a partir do dado oficial'),
        h('p', { class: 'legenda-painel', style: 'margin-top:14px' },
          `O dado oficial mais recente é de ${reais(total, { longo: true, casas: 2 })} ${periodoTexto} (RREO, ${ref.periodo}º bimestre). `,
          `O contador projeta o ritmo médio desse período, de ${reais(ritmo * 1000, { casas: 0 })} por segundo, até agora. Ele se corrige sozinho quando o Tesouro publica o próximo relatório.`,
        ),
      ),
      h('dl', { class: 'fatos' },
        h('div', {}, h('dt', { texto: `Arrecadado ${periodoTexto}` }), h('dd', { texto: reais(total, { casas: 2 }) })),
        h('div', {}, h('dt', { texto: `Variação sobre o mesmo período de ${ref.ano - 1}, descontada a inflação` }), h('dd', { texto: comparacao })),
        popAno ? h('div', {}, h('dt', { texto: 'Por habitante, no período' }), h('dd', { texto: reaisCheios(total / popAno[1]) })) : null,
        h('div', {}, h('dt', { texto: 'Impostos, taxas e contribuições de melhoria' }), h('dd', { texto: reais(dado.receitaTributaria, { casas: 2 }) })),
        h('div', {}, h('dt', { texto: 'Contribuições (inclui as previdenciárias)' }), h('dd', { texto: reais(dado.contribuicoes, { casas: 2 }) })),
      ),
    ),
    h('div', { class: 'painel__rodape' },
      h('span', {}, 'Fonte: Tesouro Nacional, RREO da União, anexo 1. ', h('a', { href: dado.urls.anexo1, target: '_blank', rel: 'noopener', texto: 'Dados brutos' })),
      h('span', {}, 'Estados e municípios não estão incluídos. O ', h('a', { href: 'https://impostometro.com.br/', target: '_blank', rel: 'noopener', texto: 'Impostômetro' }), ', da Associação Comercial de São Paulo, publica uma estimativa privada das três esferas.'),
    ),
  );
}

function renderDividas() {
  const S = D.indicadores.series;
  const faixas = faixasMandatos(D.mandatos.mandatos);
  const painel = $('painel-divida');
  const graf = h('div');
  const series = [
    S.dbgg && { nome: 'Dívida bruta', cor: 'var(--serie-1)', pontos: paraIndices(S.dbgg.pontos), tendencia: tendenciaDosPontos(S.dbgg.pontos, S.dbgg.unidade, S.dbgg.casas, S.dbgg.sentido) },
    S.dlsp && { nome: 'Dívida líquida', cor: 'var(--serie-2)', pontos: paraIndices(S.dlsp.pontos), tendencia: tendenciaDosPontos(S.dlsp.pontos, S.dlsp.unidade, S.dlsp.casas, S.dlsp.sentido) },
  ].filter(Boolean);
  painel.replaceChildren(
    h('div', { class: 'painel__topo' },
      h('div', {}, h('h3', { class: 'subtitulo', texto: 'Dívida pública, em % do PIB' }), h('p', { class: 'legenda-painel', texto: 'Saldo no fim de cada mês, dividido pelo PIB dos 12 meses anteriores.' })),
      S.dbgg ? selo(S.dbgg.status) : null,
    ),
    h('div', { class: 'legenda' }, series.map((s) => h('span', {}, h('i', { style: `background:${s.cor}` }), s.nome))),
    graf,
    h('div', { class: 'painel__rodape' },
      h('span', { texto: 'Fonte: Banco Central do Brasil (SGS 13762 e 4513).' }),
      botaoTabela(graf, () =>
        tabela(['Mês', 'Dívida bruta', 'Dívida líquida'], [...S.dbgg.pontos].reverse().slice(0, 36).map(([p, v]) => [rotulo(S.dbgg, p), `${N.formatarNumero(v, 1)}%`, (() => { const x = S.dlsp?.pontos.find(([q]) => q === p); return x ? `${N.formatarNumero(x[1], 1)}%` : '—'; })()]), 'Dívida pública em % do PIB'),
      ),
    ),
  );
  graficoLinhas(graf, {
    titulo: 'Dívida bruta e dívida líquida do setor público, em % do PIB',
    series,
    faixas,
    marcasX: marcasAnos,
    formatoEixo: (v) => `${N.formatarNumero(v, 0)}%`,
    formatoRotulo: (v) => `${N.formatarNumero(v, 1)}%`,
    formatoDica: (v) => `${N.formatarNumero(v, 1)}% do PIB`,
    rotuloX: (x) => N.rotuloPeriodo(N.periodoDeIndice(x), 'mensal', { longo: true }),
  });

  const p = S.primario;
  const graf2 = h('div');
  $('painel-primario').replaceChildren(
    h('div', { class: 'painel__topo' },
      h('div', {}, h('h3', { class: 'subtitulo', texto: 'Resultado primário em 12 meses, em % do PIB' }), h('p', { class: 'legenda-painel', texto: 'Abaixo de zero, déficit: as despesas superaram as receitas, sem contar os juros.' })),
      p ? selo(p.status) : null,
    ),
    graf2,
    h('div', { class: 'painel__rodape' },
      h('span', { texto: 'Fonte: Banco Central do Brasil (SGS 5793, sinal invertido).' }),
      p ? botaoTabela(graf2, () => tabela(['Mês', 'Resultado'], [...p.pontos].reverse().slice(0, 36).map(([q, v]) => [rotulo(p, q), `${N.formatarNumero(v, 2)}% do PIB`]), 'Resultado primário')) : null,
    ),
  );
  if (p) {
    graficoLinhas(graf2, {
      titulo: 'Resultado primário do setor público consolidado, acumulado em 12 meses, em % do PIB',
      series: [{ nome: 'Resultado primário', cor: 'var(--serie-1)', pontos: paraIndices(p.pontos), tendencia: tendenciaDosPontos(p.pontos, p.unidade, p.casas, p.sentido) }],
      faixas,
      incluirZero: true,
      marcasX: marcasAnos,
      formatoEixo: (v) => `${N.formatarNumero(v, 0)}%`,
      formatoRotulo: (v) => `${N.formatarNumero(v, 2)}%`,
      formatoDica: (v) => `${N.formatarNumero(v, 2)}% do PIB${v < 0 ? ' (déficit)' : v > 0 ? ' (superávit)' : ''}`,
      rotuloX: (x) => N.rotuloPeriodo(N.periodoDeIndice(x), 'mensal', { longo: true }),
    });
  }
}

// ---------- Gastos por área ----------

const AREAS_DESTAQUE = ['Saúde', 'Educação', 'Assistência Social', 'Segurança Pública', 'Ciência e Tecnologia', 'Transporte'];

function contextoOrcamento() {
  const O = D.orcamento;
  const indice = D.indicadores.auxiliares?.ipcaIndice?.pontos;
  const ref = O.referencia;
  const mesesParciais = ref.periodo < 6 ? `jan–${N.MESES_CURTOS[ref.mesFinal - 1]}` : null;
  const refIndice = indice?.[indice.length - 1]?.[0];
  return {
    O,
    ref,
    indice,
    mesesParciais,
    refIndiceTexto: refIndice ? N.rotuloPeriodo(refIndice, 'mensal') : '',
    dado: (ano, periodo) => O.anos.find((a) => a.ano === ano)?.[periodo] ?? null,
    corrigir: (valor, ano, mesFinal, real) => {
      if (!real || valor == null) return valor;
      const f = N.fatorDeflacao(indice, ano, mesFinal);
      return f ? valor * f.fator : valor;
    },
  };
}

const estadoGastos = { ano: null, periodo: null, real: true, encargos: false, funcaoAberta: null };

function renderGastos() {
  if (!D.orcamento) return;
  const C = contextoOrcamento();
  estadoGastos.periodo ??= C.ref.periodo < 6 ? 'mesmoPeriodo' : 'completo';
  const anosDisponiveis = C.O.anos.filter((a) => a[estadoGastos.periodo]).map((a) => a.ano);
  if (!anosDisponiveis.includes(estadoGastos.ano)) estadoGastos.ano = anosDisponiveis[anosDisponiveis.length - 1];
  const E = estadoGastos;
  const mudar = (campo) => (valor) => {
    E[campo] = valor;
    renderGastos();
  };

  const opcoesPeriodo = [['completo', 'Ano inteiro']];
  if (C.mesesParciais) opcoesPeriodo.push(['mesmoPeriodo', `${C.mesesParciais[0].toUpperCase()}${C.mesesParciais.slice(1)} de cada ano`]);
  $('controles-gastos').replaceChildren(
    h('div', {}, h('span', { class: 'controle-rotulo', texto: 'Ano' }), alternador('Ano', anosDisponiveis.map((a) => [a, String(a)]), E.ano, mudar('ano'))),
    h('div', {}, h('span', { class: 'controle-rotulo', texto: 'Período' }), alternador('Período', opcoesPeriodo, E.periodo, mudar('periodo'))),
    h('div', {}, h('span', { class: 'controle-rotulo', texto: 'Valores' }), alternador('Valores', [[true, 'Corrigidos pela inflação'], [false, 'Da época']], E.real, mudar('real'))),
  );

  const dado = C.dado(E.ano, E.periodo);
  const mesFinal = dado.mesFinal;
  const periodoTexto = mesFinal === 12 ? `${E.ano}` : `${E.ano}, de janeiro a ${N.MESES[mesFinal - 1]}`;
  const unidadeTexto = E.real ? `Em reais de ${C.refIndiceTexto}, corrigidos pelo IPCA.` : 'Em reais da época, sem correção.';
  const anterior = C.dado(E.ano - 1, E.periodo);
  const variacaoReal = (nome) => {
    const atual = dado.funcoes.find((f) => f.nome === nome)?.valor;
    const antes = anterior?.funcoes.find((f) => f.nome === nome)?.valor;
    if (!atual || !antes) return null;
    const v = (C.corrigir(atual, E.ano, mesFinal, true) / C.corrigir(antes, E.ano - 1, mesFinal, true) - 1) * 100;
    return `${v >= 0 ? '+' : '−'}${N.formatarNumero(Math.abs(v), 1)}% sobre ${E.ano - 1}, descontada a inflação`;
  };

  // Barras por função
  const encargos = dado.funcoes.find((f) => f.nome === 'Encargos Especiais');
  const funcoes = dado.funcoes
    .filter((f) => f.valor > 0 && f.nome !== 'Reserva de Contingência' && (E.encargos || f.nome !== 'Encargos Especiais'))
    .map((f) => ({ rotulo: f.nome, valor: C.corrigir(f.valor, E.ano, mesFinal, E.real), dica: variacaoReal(f.nome), original: f }))
    .sort((a, b) => b.valor - a.valor);
  const graf = h('div');
  const detalheFuncao = h('div');
  const mostrarSubfuncoes = (item) => {
    E.funcaoAberta = item.rotulo;
    const f = item.original;
    detalheFuncao.replaceChildren(
      h('h4', { class: 'subtitulo', style: 'margin-top:20px', texto: `${f.nome}: para onde foi o dinheiro` }),
      tabela(
        ['Subfunção', 'Valor', 'Parcela'],
        [...f.subfuncoes].sort((a, b) => b.valor - a.valor).map((s) => [s.nome, reais(C.corrigir(s.valor, E.ano, mesFinal, E.real)), `${N.formatarNumero((s.valor / f.valor) * 100, 1)}%`]),
        `Subfunções de ${f.nome}`,
      ),
    );
  };
  const totalExibido = C.corrigir(dado.total, E.ano, mesFinal, E.real);
  $('painel-funcoes').replaceChildren(
    h('div', { class: 'painel__topo' },
      h('div', {},
        h('h3', { class: 'subtitulo', texto: `Despesa por área em ${periodoTexto}` }),
        h('p', { class: 'legenda-painel', texto: `${unidadeTexto} Total empenhado: ${reais(totalExibido, { longo: true, casas: 2 })}. Clique em uma barra para ver as subáreas.` }),
      ),
      h('label', { class: 'legenda-painel', style: 'display:flex;gap:8px;align-items:center;cursor:pointer' },
        h('input', { type: 'checkbox', checked: E.encargos || null, onchange: (e) => mudar('encargos')(e.target.checked) }),
        'Incluir encargos especiais',
      ),
    ),
    graf,
    detalheFuncao,
    h('div', { class: 'painel__rodape' },
      h('span', {},
        !E.encargos && encargos ? `Encargos especiais (juros e amortização da dívida, transferências a estados e municípios) somaram ${reais(C.corrigir(encargos.valor, E.ano, mesFinal, E.real))} e estão fora do gráfico. ` : '',
        dado.ajustes?.length ? `Neste ano, o Tesouro incluiu ${reais(dado.ajustes.reduce((s, a) => s + a.valor, 0))} de refinanciamento da dívida no anexo; retiramos esse valor para manter a comparação com os outros anos. ` : '',
        'Fonte: Tesouro Nacional, RREO, anexo 2. ',
        h('a', { href: dado.urls.anexo2, target: '_blank', rel: 'noopener', texto: 'Dados brutos' }),
      ),
      botaoTabela(graf, () => tabela(['Área', 'Valor', `Variação real sobre ${E.ano - 1}`], funcoes.map((f) => [f.rotulo, reais(f.valor), f.dica ?? '—']), 'Despesa por área')),
    ),
  );
  graficoBarras(graf, {
    titulo: `Despesa empenhada da União por função em ${periodoTexto}`,
    itens: funcoes,
    formato: (v) => reais(v),
    aoClicar: mostrarSubfuncoes,
  });
  const aberta = funcoes.find((f) => f.rotulo === E.funcaoAberta);
  if (aberta) mostrarSubfuncoes(aberta);

  // Investimentos por ano
  const anos = C.O.anos.filter((a) => a[E.periodo]);
  const mandatoDoAno = (ano) => N.mandatoEm(`${ano}-06-01`, D.mandatos.mandatos);
  const colunas = anos.map((a) => {
    const d = a[E.periodo];
    return {
      rotulo: String(a.ano),
      rotuloLongo: d.mesFinal === 12 ? String(a.ano) : `${a.ano} (jan–${N.MESES_CURTOS[d.mesFinal - 1]})`,
      valor: C.corrigir(d.investimentosEmpenhados, a.ano, d.mesFinal, E.real),
      grupo: mandatoDoAno(a.ano)?.id,
      dica: `Liquidado: ${reais(C.corrigir(d.investimentosLiquidados, a.ano, d.mesFinal, E.real))}`,
    };
  });
  const faixasCol = D.mandatos.mandatos.filter((m) => colunas.some((c) => c.grupo === m.id));
  const grafInv = h('div');
  $('painel-investimentos').replaceChildren(
    h('div', { class: 'painel__topo' },
      h('div', {},
        h('h3', { class: 'subtitulo', texto: `Investimentos da União${E.periodo === 'mesmoPeriodo' ? `, de janeiro a ${N.MESES[C.ref.mesFinal - 1]} de cada ano` : ', por ano'}` }),
        h('p', { class: 'legenda-painel', texto: `Obras, equipamentos e instalações (grupo de despesa 4), valor empenhado. ${unidadeTexto}` }),
      ),
    ),
    grafInv,
    h('div', { class: 'painel__rodape' },
      h('span', { texto: 'Parte do valor empenhado é paga nos anos seguintes, como restos a pagar. Fonte: Tesouro Nacional, RREO, anexo 1.' }),
      botaoTabela(grafInv, () => tabela(['Ano', 'Empenhado', 'Liquidado'], colunas.map((c) => [c.rotuloLongo, reais(c.valor), c.dica.replace('Liquidado: ', '')]), 'Investimentos da União')),
    ),
  );
  graficoColunas(grafInv, {
    titulo: 'Investimentos empenhados pela União por ano',
    itens: colunas,
    faixas: faixasCol,
    formato: (v) => reais(v),
    formatoCurto: (v) => reais(v, { casas: 0 }).replace('R$ ', ''),
  });

  // Pequenos múltiplos por área
  const areas = AREAS_DESTAQUE.map((nome) => {
    const itens = anos.map((a) => {
      const d = a[E.periodo];
      const f = d.funcoes.find((x) => x.nome === nome);
      return { rotulo: String(a.ano), rotuloLongo: `${nome}, ${a.ano}`, valor: C.corrigir(f?.valor ?? 0, a.ano, d.mesFinal, E.real) };
    });
    const g = h('div');
    return { nome, itens, g };
  });
  $('painel-areas').replaceChildren(
    h('div', { class: 'painel__topo' },
      h('div', {},
        h('h3', { class: 'subtitulo', texto: 'Seis áreas ano a ano' }),
        h('p', { class: 'legenda-painel', texto: `${E.periodo === 'mesmoPeriodo' ? `De janeiro a ${N.MESES[C.ref.mesFinal - 1]} de cada ano. ` : ''}${unidadeTexto} Cada gráfico tem a própria escala.` }),
      ),
    ),
    h('div', { class: 'multiplos' }, areas.map((a) => h('div', {}, h('h4', { texto: a.nome }), a.g))),
  );
  for (const a of areas) {
    graficoColunas(a.g, { titulo: `${a.nome} por ano`, itens: a.itens, altura: 150, formato: (v) => reais(v), formatoCurto: (v) => reais(v, { casas: 0 }).replace('R$ ', '') });
  }
}

// ---------- Programas ----------

const estadoProgramas = { filtro: 'todos', mandato: 'todos', todos: false };

const SITUACOES = {
  'Transformado em Norma Jurídica': 'Virou lei',
  'Transformado em nova proposição': 'Substituída por outra proposição',
  'Perdeu a Eficácia': 'Perdeu a validade sem ser votada',
  'Arquivada': 'Arquivada',
};

function virouLei(i) {
  return /Transformad[oa] em Norma Jurídica/i.test(i.situacao || '');
}

function renderProgramas() {
  const P = D.programas;
  if (!P) return;
  const M = D.mandatos.mandatos;
  const E = estadoProgramas;
  $('placar-programas').replaceChildren(
    ...M.map((m) => {
      const itens = P.itens.filter((i) => i.mandato === m.id);
      const comecou = D.hoje >= m.inicio;
      return h('div', {},
        h('div', { class: 'placar__mandato', texto: `Mandato ${m.rotulo}` }),
        h('div', { class: 'placar__numero', texto: comecou ? String(itens.length) : '—' }),
        h('div', {
          class: 'placar__detalhe',
          texto: comecou
            ? `${itens.filter((i) => i.social).length} classificados como sociais, ${itens.filter(virouLei).length} viraram lei`
            : `Começa em ${N.rotuloPeriodo(m.inicio, 'diaria')}`,
        }),
      );
    }),
  );

  const mudar = (campo) => (valor) => {
    E[campo] = valor;
    E.todos = false;
    renderProgramas();
  };
  $('controles-programas').replaceChildren(
    alternador('Tipo de programa', [['todos', 'Todos'], ['social', 'Classificados como sociais']], E.filtro, mudar('filtro')),
    alternador('Mandato', [['todos', 'Todos os mandatos'], ...M.filter((m) => D.hoje >= m.inicio).map((m) => [m.id, m.rotulo])], E.mandato, mudar('mandato')),
  );

  const filtrados = P.itens.filter((i) => (E.filtro === 'todos' || i.social) && (E.mandato === 'todos' || i.mandato === E.mandato));
  const visiveis = E.todos ? filtrados : filtrados.slice(0, 8);
  $('lista-programas').replaceChildren(
    ...(visiveis.length
      ? visiveis.map((i) => {
          const [original, nova] = i.ementa.split(/\s*NOVA EMENTA:\s*/i);
          return h('li', { class: 'programa' },
            h('div', {},
              h('div', { class: 'programa__id', texto: `${i.siglaTipo === 'MPV' ? 'MP' : i.siglaTipo} ${numeroProposicao(i.numero)}/${i.ano}` }),
              h('div', { class: 'programa__data', texto: `Apresentada em ${N.rotuloPeriodo(i.dataApresentacao, 'diaria')}` }),
            ),
            h('div', {},
              h('p', { class: 'programa__ementa', texto: original }),
              h('div', { class: 'programa__meta' },
                i.social
                  ? h('span', { class: 'etiqueta etiqueta--social', title: i.classificacao === 'automatica' ? `Classificação automática. Palavras encontradas: ${i.palavrasSociais.join(', ')}` : i.notaRevisao || 'Revisado por editor' }, 'Social')
                  : h('span', { class: 'etiqueta', texto: 'Outras áreas' }),
                h('span', { texto: i.situacao ? SITUACOES[i.situacao] ?? i.situacao : 'Situação não informada' }),
                nova ? h('span', { texto: 'Ementa alterada pelo Congresso' }) : null,
                h('a', { href: i.link, target: '_blank', rel: 'noopener', texto: 'Ficha na Câmara' }),
                i.inteiroTeor ? h('a', { href: i.inteiroTeor, target: '_blank', rel: 'noopener', texto: 'Texto original' }) : null,
              ),
            ),
          );
        })
      : [h('li', { class: 'programa' }, h('p', { texto: 'Nenhuma proposição com esses filtros.' }))]),
  );
  $('mais-programas').replaceChildren(
    filtrados.length > visiveis.length
      ? h('button', { class: 'botao botao--leve', type: 'button', texto: `Mostrar todas as ${filtrados.length}`, onclick: () => { E.todos = true; renderProgramas(); } })
      : h('p', { class: 'legenda-painel', texto: `A classificação “social” é feita por palavras-chave na ementa e pode errar; passe o mouse sobre a etiqueta para ver as palavras encontradas. Programas criados por decreto ou por iniciativa do Congresso não aparecem aqui.` }),
  );

  renderGastoSocial();
}

function renderGastoSocial() {
  if (!D.orcamento) return;
  const C = contextoOrcamento();
  const periodo = C.ref.periodo < 6 ? 'mesmoPeriodo' : 'completo';
  const anos = C.O.anos.filter((a) => a[periodo]);
  const colunas = anos.map((a) => {
    const d = a[periodo];
    const f = d.funcoes.find((x) => x.nome === 'Assistência Social');
    return { rotulo: String(a.ano), rotuloLongo: `Assistência social, ${a.ano}`, valor: C.corrigir(f?.valor ?? 0, a.ano, d.mesFinal, true), grupo: N.mandatoEm(`${a.ano}-06-01`, D.mandatos.mandatos)?.id };
  });
  const ultimo = anos[anos.length - 1][periodo];
  const assist = ultimo.funcoes.find((x) => x.nome === 'Assistência Social');
  const graf = h('div');
  const grafSub = h('div');
  $('painel-social').replaceChildren(
    h('div', { class: 'painel__topo' },
      h('div', {},
        h('h3', { class: 'subtitulo', texto: `Gasto federal com assistência social${periodo === 'mesmoPeriodo' ? `, de janeiro a ${N.MESES[C.ref.mesFinal - 1]} de cada ano` : ''}` }),
        h('p', { class: 'legenda-painel', texto: `Inclui transferência de renda (como o Bolsa Família), benefícios a idosos e pessoas com deficiência e a rede de assistência. Em reais de ${C.refIndiceTexto}, corrigidos pelo IPCA.` }),
      ),
    ),
    h('div', { class: 'painel-grade' },
      h('div', {}, graf),
      h('div', {}, h('h4', { class: 'legenda-painel', style: 'margin-bottom:8px', texto: `Divisão em ${anos[anos.length - 1].ano}` }), grafSub),
    ),
    h('div', { class: 'painel__rodape' },
      h('span', { texto: 'O número de famílias atendidas por cada programa não tem API pública aberta; por isso não é exibido aqui. Fonte: Tesouro Nacional, RREO, anexo 2.' }),
    ),
  );
  graficoColunas(graf, {
    titulo: 'Gasto federal com assistência social por ano',
    itens: colunas,
    faixas: D.mandatos.mandatos.filter((m) => colunas.some((c) => c.grupo === m.id)),
    formato: (v) => reais(v),
    formatoCurto: (v) => reais(v, { casas: 0 }).replace('R$ ', ''),
  });
  if (assist) {
    graficoBarras(grafSub, {
      titulo: 'Divisão do gasto com assistência social por subfunção',
      itens: [...assist.subfuncoes]
        .filter((s) => s.valor > 0)
        .sort((a, b) => b.valor - a.valor)
        .map((s) => ({ rotulo: s.nome === 'Demais Subfunções' ? 'Demais subfunções' : s.nome, valor: C.corrigir(s.valor, anos[anos.length - 1].ano, ultimo.mesFinal, true) })),
      formato: (v) => reais(v),
    });
  }
}

// ---------- Mandatos ----------

function renderMandatos() {
  const M = D.mandatos.mandatos;
  const [mA, mB] = D.mandatos.comparacao.map((id) => M.find((m) => m.id === id));
  const S = D.indicadores.series;
  const comparaveis = Object.values(S).filter((s) => s.comparar);
  const resultados = comparaveis.map((s) => ({ s, r: N.compararMandatos(s.pontos.filter(([p]) => p.length > 4), mA, mB) }));
  const meses = Math.max(0, ...resultados.map((x) => x.r.meses));
  const comecou = D.hoje >= mB.inicio;

  const faltam = N.diasAte(mB.inicio, D.hoje);
  $('aviso-mandato').replaceChildren(
    h('div', { class: 'aviso-mandato' },
      comecou
        ? h('div', { class: 'aviso-mandato__numero' }, `Mês ${meses || 1}`, h('small', { texto: `do mandato ${mB.rotulo}` }))
        : h('div', { class: 'aviso-mandato__numero' }, `${faltam} dias`, h('small', { texto: `para a posse de ${mB.rotulo}` })),
      h('p', {
        texto: comecou
          ? meses
            ? `Os indicadores do mandato ${mB.rotulo} já cobrem até ${meses} ${meses === 1 ? 'mês' : 'meses'} de governo. Cada linha compara com o mesmo mês do mandato ${mA.rotulo}, e a coluna “Final” mostra como o mandato anterior terminou.`
            : `O mandato ${mB.rotulo} começou, mas os órgãos ainda não publicaram dados referentes a ele. A comparação aparece automaticamente com a primeira divulgação.`
          : `O mandato ${mB.rotulo} começa em ${N.dataPorExtenso(mB.inicio).texto}. Até lá, a tabela mostra de onde o mandato ${mA.rotulo} partiu e onde está agora. Depois da posse, as colunas da direita se preenchem sozinhas, sempre no mesmo mês de governo.`,
      }),
    ),
  );

  // Tabela
  const v = (s, p) => (p ? fmt(s, p.valor) : '—');
  const per = (s, p) => (p ? rotulo(s, p.periodo) : '');
  const dif = (s, de, para) => (de && para ? N.diferenca(de.valor, para.valor, s.unidade, s.casas).texto : '—');
  const linhas = resultados.map(({ s, r }) => {
    const pontoA = r.meses ? r.A.mesmoPonto : r.A.final;
    return [
      s.nome,
      `${v(s, r.A.base)} (${per(s, r.A.base)})`,
      `${v(s, pontoA)} (${per(s, pontoA)})`,
      dif(s, r.A.base, pontoA),
      ...(r.meses ? [`${v(s, r.A.final)}`] : []),
      r.B.base && comecou ? `${v(s, r.B.base)} (${per(s, r.B.base)})` : '—',
      r.B.atual ? `${v(s, r.B.atual)} (${per(s, r.B.atual)})` : '—',
      dif(s, r.B.base, r.B.atual),
    ];
  });
  const P = D.programas;
  if (P) {
    const ate = (m, n) => {
      const limite = N.periodoDeIndice(N.indiceMes(m.inicio.slice(0, 7)) + n - 1);
      return P.itens.filter((i) => i.mandato === m.id && i.dataApresentacao.slice(0, 7) <= limite).length;
    };
    const mesesB = comecou ? Math.max(1, N.indiceMes(D.hoje.slice(0, 7)) - N.indiceMes(mB.inicio.slice(0, 7)) + 1) : 0;
    const totalA = P.itens.filter((i) => i.mandato === mA.id).length;
    linhas.push([
      'Programas propostos pelo Executivo (detector)',
      '—',
      mesesB ? `${ate(mA, mesesB)} até o mês ${mesesB}` : `${totalA} até agora`,
      '—',
      ...(meses ? [String(totalA)] : []),
      '—',
      mesesB ? `${ate(mB, mesesB)} até o mês ${mesesB}` : '—',
      '—',
    ]);
  }
  const cab = ['Indicador', 'Início', meses ? `Mês ${meses}` : 'Mais recente', 'Variação', ...(meses ? ['Final'] : []), 'Início', meses ? `Mês ${meses}` : 'Mais recente', 'Variação'];
  const tab = tabela(cab, linhas, `Comparativo entre os mandatos ${mA.rotulo} e ${mB.rotulo}`);
  tab.querySelector('table').classList.add('tabela-mandatos');
  const grupoLinha = document.createElement('tr');
  grupoLinha.append(
    h('th', { scope: 'col' }),
    h('th', { scope: 'colgroup', colspan: meses ? 4 : 3, class: 'grupo-coluna', texto: `Mandato ${mA.rotulo}` }),
    h('th', { scope: 'colgroup', colspan: 3, class: 'grupo-coluna', texto: `Mandato ${mB.rotulo}` }),
  );
  tab.querySelector('thead').prepend(grupoLinha);
  $('painel-tabela-mandatos').replaceChildren(
    h('div', { class: 'painel__topo' },
      h('div', {},
        h('h3', { class: 'subtitulo', texto: 'Indicadores no mesmo ponto de cada mandato' }),
        h('p', { class: 'legenda-painel', texto: '“Início” é o último dado publicado antes da posse, ou seja, o que cada mandato recebeu. As variações de taxas estão em pontos percentuais (p.p.); as de valores em reais, em %.' }),
      ),
    ),
    tab,
  );

  // Pequenos múltiplos alinhados pelo mês de mandato
  const blocos = resultados.map(({ s, r }) => {
    const g = h('div');
    const pts = (al) => [...(al.base ? [[0, al.base.valor]] : []), ...al.serie.map((p) => [p.k, p.valor])];
    return { s, g, series: [
      { nome: mA.rotulo, cor: 'var(--serie-1)', pontos: pts(r.A), tendencia: tendenciaDosPontos(pts(r.A), s.unidade, s.casas, s.sentido) },
      { nome: mB.rotulo, cor: 'var(--serie-2)', pontos: comecou ? pts(r.B) : [], tendencia: comecou ? tendenciaDosPontos(pts(r.B), s.unidade, s.casas, s.sentido) : null },
    ] };
  });
  $('painel-multiplos').replaceChildren(
    h('div', { class: 'painel__topo' },
      h('div', {},
        h('h3', { class: 'subtitulo', texto: 'Mês a mês de governo' }),
        h('p', { class: 'legenda-painel', texto: 'Eixo horizontal: meses desde a posse (0 é o dado recebido). As duas linhas ficam sobrepostas no mesmo calendário para que nenhum mandato seja medido por mais tempo que o outro.' }),
      ),
    ),
    h('div', { class: 'legenda' },
      h('span', {}, h('i', { style: 'background:var(--serie-1)' }), `Mandato ${mA.rotulo}`),
      h('span', {}, h('i', { style: 'background:var(--serie-2)' }), `Mandato ${mB.rotulo}${comecou ? '' : ' (a partir de 5/1/2027)'}`),
    ),
    h('div', { class: 'multiplos' }, blocos.map((b) => h('div', {}, h('h4', { texto: b.s.nome }), h('p', { texto: b.s.unidade }), b.g))),
  );
  for (const b of blocos) {
    graficoLinhas(b.g, {
      titulo: `${b.s.nome} por mês de mandato`,
      series: b.series,
      altura: 170,
      dominioX: [0, 48],
      margemEsq: 40,
      rotuloFinal: true,
      marcasX: () => [0, 12, 24, 36, 48].map((x) => ({ x, rotulo: x === 0 ? 'posse' : `ano ${x / 12}` })),
      formatoEixo: eixo,
      formatoRotulo: (y) => fmt(b.s, y, { compacto: true }),
      formatoDica: (y) => fmt(b.s, y),
      rotuloX: (x) => (x === 0 ? 'Recebido na posse' : `Mês ${x} de mandato`),
    });
  }

  renderOrcamentoMandatos(mA, mB);
}

const estadoOrcamentoMandatos = { periodo: null };

function renderOrcamentoMandatos(mA, mB) {
  if (!D.orcamento) return;
  const C = contextoOrcamento();
  const E = estadoOrcamentoMandatos;
  E.periodo ??= C.ref.periodo < 6 ? 'mesmoPeriodo' : 'completo';
  const anosDe = (m) => [0, 1, 2, 3].map((i) => Number(m.inicio.slice(0, 4)) + i);
  const celula = (ano, extrair) => {
    const d = C.dado(ano, E.periodo);
    if (!d) return { texto: '—', valor: null };
    const bruto = extrair(d);
    if (bruto == null) return { texto: '—', valor: null };
    return { texto: reais(C.corrigir(bruto, ano, d.mesFinal, true)), valor: bruto };
  };
  const funcao = (nome) => (d) => d.funcoes.find((f) => f.nome === nome)?.valor ?? null;
  const linhasDef = [
    ['Arrecadação (impostos e contribuições)', (d) => d.receitaTributaria + d.contribuicoes],
    ['Despesa total por áreas', (d) => d.total],
    ['Saúde', funcao('Saúde')],
    ['Educação', funcao('Educação')],
    ['Assistência social', funcao('Assistência Social')],
    ['Segurança pública', funcao('Segurança Pública')],
    ['Investimentos', (d) => d.investimentosEmpenhados],
    ['Juros da dívida', (d) => d.juros],
  ];
  const anosA = anosDe(mA);
  const anosB = anosDe(mB);
  const linhas = linhasDef.map(([nome, f]) => [nome, ...anosA.map((a) => celula(a, f).texto), ...anosB.map((a) => celula(a, f).texto)]);
  const tab = tabela(['Valor', ...anosA.map((a, i) => `Ano ${i + 1} (${a})`), ...anosB.map((a, i) => `Ano ${i + 1} (${a})`)], linhas, 'Execução orçamentária por ano de mandato');
  const grupoLinha = document.createElement('tr');
  grupoLinha.append(
    h('th', { scope: 'col' }),
    h('th', { scope: 'colgroup', colspan: 4, class: 'grupo-coluna', texto: `Mandato ${mA.rotulo}` }),
    h('th', { scope: 'colgroup', colspan: 4, class: 'grupo-coluna', texto: `Mandato ${mB.rotulo}` }),
  );
  tab.querySelector('thead').prepend(grupoLinha);
  tab.querySelector('table').classList.add('tabela-mandatos');
  const periodoTexto =
    E.periodo === 'mesmoPeriodo'
      ? `De janeiro a ${N.MESES[C.ref.mesFinal - 1]} de cada ano, para que o ano em curso possa ser comparado com os anteriores.`
      : `Anos completos. ${C.ref.periodo < 6 ? `${C.ref.ano} aparece quando o Tesouro publicar o relatório de dezembro.` : ''}`;
  $('painel-orcamento-mandatos').replaceChildren(
    h('div', { class: 'painel__topo' },
      h('div', {},
        h('h3', { class: 'subtitulo', texto: 'Orçamento da União por ano de mandato' }),
        h('p', { class: 'legenda-painel', texto: `Receitas realizadas e despesas empenhadas, em reais de ${C.refIndiceTexto}, corrigidos pelo IPCA. ${periodoTexto}` }),
      ),
      C.mesesParciais
        ? alternador('Período', [['mesmoPeriodo', `${C.mesesParciais[0].toUpperCase()}${C.mesesParciais.slice(1)}`], ['completo', 'Ano inteiro']], E.periodo, (v) => {
            E.periodo = v;
            renderOrcamentoMandatos(mA, mB);
          })
        : null,
    ),
    tab,
    h('div', { class: 'painel__rodape' }, h('span', { texto: 'O primeiro ano de cada mandato executa um orçamento aprovado no ano anterior. Fonte: Tesouro Nacional, RREO, anexos 1 e 2.' })),
  );
}

// ---------- Notícias ----------

const estadoNoticias = { filtro: 'dados' };

function avisoNoticiasIbge(Nt) {
  const aviso = $('aviso-noticias');
  const fonte = Nt.fontes?.find((f) => f.fonte === 'IBGE');
  const desde = fonte?.ultimoSucesso ? `em ${dataCurta(fonte.ultimoSucesso)} às ${horaBrasilia(fonte.ultimoSucesso)}` : 'numa coleta anterior';
  const textos = {
    buscando: 'Buscando as notícias mais recentes do IBGE pelo seu navegador…',
    ok: 'As notícias do IBGE abaixo foram buscadas agora pelo seu navegador, direto da API oficial: o servidor do IBGE não aceita a coleta automática, que roda fora do Brasil. O mesmo filtro político e a mesma conferência de números foram aplicados.',
    falhou: `Não foi possível obter notícias novas do IBGE: nem a coleta automática nem o seu navegador conseguiram acessar a API. As notícias do IBGE abaixo são as obtidas ${desde}.`,
  };
  const estado = Nt.ibgeNoNavegador?.estado;
  aviso.hidden = !estado;
  aviso.textContent = estado ? textos[estado] : '';
}

function renderNoticias() {
  const Nt = D.noticias;
  if (!Nt) return;
  avisoNoticiasIbge(Nt);
  const E = estadoNoticias;
  $('controles-noticias').replaceChildren(
    alternador('Tipo de notícia', [['dados', 'Divulgações de dados'], ['todas', 'Todas, inclusive institucionais']], E.filtro, (v) => {
      E.filtro = v;
      renderNoticias();
    }),
  );
  const itens = Nt.itens.filter((n) => E.filtro === 'todas' || n.categoria === 'dados').slice(0, 20);
  $('lista-noticias').replaceChildren(
    ...itens.map((n) => {
      const num = n.verificacoes.numero;
      return h('li', { class: 'noticia' },
        h('div', { class: 'noticia__topo' },
          h('span', { class: 'noticia__fonte', texto: n.fonteNome }),
          h('span', { texto: n.tipo }),
          h('time', { datetime: n.publicadoEm, texto: `${dataCurta(n.publicadoEm)} às ${horaBrasilia(n.publicadoEm)}` }),
        ),
        h('h3', {}, h('a', { href: n.link, target: '_blank', rel: 'noopener', texto: n.titulo })),
        n.resumo ? h('p', { class: 'noticia__resumo', texto: n.resumo }) : null,
        h('div', { class: 'checagens' },
          selo('confere', `Publicado pelo ${n.fonte === 'BCB' ? 'Banco Central' : 'IBGE'}`),
          selo('confere', 'Sem termos político-partidários'),
          num ? (num.ok === true ? selo('confere', num.nota) : selo('sem-conferencia', num.nota)) : null,
        ),
      );
    }),
  );

  const ex = $('excluidos');
  ex.replaceChildren(
    h('summary', { texto: `Itens retirados pelo filtro político nesta coleta: ${Nt.excluidos.length}` }),
    Nt.excluidos.length
      ? h('ul', {}, Nt.excluidos.map((x) => h('li', {}, h('a', { href: x.link, target: '_blank', rel: 'noopener', texto: x.titulo }), ` (${x.fonte}, termo encontrado: “${x.termo}”)`)))
      : h('p', { class: 'legenda-painel', style: 'margin-top:10px', texto: 'Nenhum comunicado oficial foi retirado hoje. A lista de termos do filtro é pública e está no arquivo config/filtro-politico.json.' }),
  );

  const Di = D.diario;
  const S = D.indicadores.series;
  const TIPOS = { registro: 'Registro inicial', novo: 'Dado novo', revisao: 'Revisão pelo órgão', programa: 'Programa detectado' };
  $('diario').replaceChildren(
    ...(Di?.entradas || []).slice(0, 18).map((e) => {
      let texto;
      if (e.serie === 'orcamento') texto = `Relatório do orçamento da União até ${N.rotuloPeriodo(e.periodo, 'mensal')}`;
      else if (e.serie === 'sinesp') texto = `Dados de segurança pública (Sinesp) até ${N.rotuloPeriodo(e.periodo, 'mensal')}`;
      else if (e.serie === 'disque100') texto = `Denúncias do Disque 100 até ${N.rotuloPeriodo(e.periodo, 'mensal')}`;
      else if (e.serie === 'programas') texto = `${e.programa.rotulo}: ${e.programa.ementa.slice(0, 110)}${e.programa.ementa.length > 110 ? '…' : ''}`;
      else if (S[e.serie]) {
        const s = S[e.serie];
        texto = `${s.nome}: ${fmt(s, e.valor)} em ${rotulo(s, e.periodo)}${e.tipo === 'revisao' ? ` (antes, ${fmt(s, e.anterior.valor)})` : ''}`;
      } else texto = e.serie;
      return h('li', {},
        h('time', { datetime: e.em, texto: dataCurta(e.em).slice(0, 5) }),
        h('div', {}, h('div', { texto }), h('div', { class: 'tipo', texto: TIPOS[e.tipo] || e.tipo })),
      );
    }),
  );
}

// ---------- Método ----------

function renderMetodo() {
  const E = D.execucao;
  const S = D.indicadores.series;
  const fontes = [
    ['IBGE', 'Inflação, PIB, desemprego, renda, população e notícias', 'SIDRA e API de notícias'],
    ['Banco Central do Brasil', 'Juros, câmbio, dívida pública, resultado primário, expectativas e notas', 'SGS, PTAX e Focus'],
    ['Tesouro Nacional', 'Receitas e despesas da União por área', 'SICONFI (RREO)'],
    ['Câmara dos Deputados', 'Medidas provisórias e projetos do Executivo', 'Dados Abertos da Câmara'],
    ['Ministério da Justiça', 'Homicídios, feminicídios, latrocínios, estupros, roubos e furtos', 'Sinesp VDE'],
    ['Ministério dos Direitos Humanos', 'Denúncias de LGBTfobia e intolerância religiosa', 'Microdados do Disque 100'],
  ];
  $('conteudo-metodo').replaceChildren(
    h('div', { class: 'prosa' },
      h('h3', { texto: 'Princípios' }),
      h('ul', {},
        h('li', { texto: 'Só fontes primárias. Cada número vem do órgão que o produz, pela API oficial, e leva o link da consulta exata.' }),
        h('li', { texto: 'Duas fontes quando existem. Inflação, desemprego e dólar são cruzados entre IBGE e Banco Central ou entre dois sistemas do Banco Central; as dívidas são recalculadas a partir do saldo em reais e do PIB.' }),
        h('li', { texto: 'Mesmo período, mesma régua. Mandatos são comparados no mesmo mês de governo, e anos do orçamento no mesmo intervalo de meses.' }),
        h('li', { texto: 'Inflação descontada. Valores em reais de anos diferentes são corrigidos pelo IPCA antes de qualquer comparação.' }),
        h('li', { texto: 'Sem adjetivos. Os textos descrevem o número e a fonte, sem qualificar o resultado. A única indicação de leitura é a cor da variação sobre o período anterior, com regra pública e fixa por indicador (tabela ao lado).' }),
        h('li', { texto: 'Nada é inventado. Se uma fonte falha, o site mostra o último dado válido com a data e o aviso da falha.' }),
        h('li', { texto: 'Histórico aberto. Cada coleta é registrada no repositório; qualquer mudança em um número fica visível no histórico de versões.' }),
      ),
      h('h3', { texto: 'Notícias e o filtro político' }),
      h('p', { texto: 'O feed reúne apenas comunicados publicados pelo IBGE e pelo Banco Central. Títulos e resumos que mencionam partidos, candidatos, eleições ou disputas partidárias são retirados e listados com o termo que provocou a exclusão. Quando o título cita um número de indicador acompanhado aqui, ele é comparado com a série oficial.' }),
      h('p', { texto: 'O site não classifica notícias como verdadeiras ou falsas. Ele mostra se o número citado bate com a série oficial e deixa o link para a fonte.' }),
      h('p', { texto: 'O servidor de notícias do IBGE não aceita conexões de fora do Brasil, onde roda a coleta automática. Quando ela falha, o seu navegador busca as notícias do IBGE direto na API oficial e aplica o mesmo filtro e a mesma conferência, com o mesmo código da coleta. Um aviso acima das notícias indica quando isso acontece.' }),
      h('h3', { texto: 'Limitações conhecidas' }),
      h('ul', {},
        h('li', { texto: 'O orçamento cobre apenas a União. Estados e municípios publicam relatórios próprios.' }),
        h('li', { texto: 'O detector de programas lê medidas provisórias e projetos de lei do Executivo. Programas criados por decreto ou por iniciativa do Congresso ficam de fora, e a classificação “social” é feita por palavras-chave.' }),
        h('li', { texto: 'O número de beneficiários de programas como o Bolsa Família não tem API pública aberta e por isso não é coletado automaticamente.' }),
        h('li', { texto: 'O contador de arrecadação é uma projeção do ritmo do último relatório oficial, não um dado em tempo real.' }),
        h('li', { texto: 'Os órgãos revisam séries com frequência. Quando isso acontece, o diário de atualizações registra o valor anterior.' }),
        h('li', { texto: 'Os dados de crimes são os registros enviados pelas polícias de cada estado ao Ministério da Justiça. Mudanças na forma de registrar de um estado aparecem como mudanças nos números; as notas metodológicas dos estados estão no link da fonte.' }),
        h('li', { texto: 'O Sinesp só tem série nacional padronizada para roubos e furtos de veículos, de carga e a instituições financeiras. Roubos e furtos de celulares e a pessoas não têm série nacional mensal oficial.' }),
        h('li', { texto: 'Homofobia, transfobia e intolerância religiosa não têm estatística policial nacional. Usamos as denúncias do Disque 100, que medem o que chega ao canal, não o total de casos.' }),
      ),
      h('h3', { texto: 'Segurança: o que testamos antes de publicar' }),
      h('p', { texto: D.seguranca?.sinesp?.notaFeminicidio || '' }),
      h('p', { texto: 'Cada planilha do Sinesp é conferida antes de ser usada: o download precisa ter o tamanho anunciado pelo servidor e a estrutura completa do arquivo, e as colunas precisam ser as esperadas. Um mês só entra na série nacional quando pelo menos 20 das 27 unidades da federação enviaram dados.' }),
      h('p', { texto: 'A contagem do Disque 100 foi conferida com uma segunda implementação independente: para julho de 2026, as duas chegaram aos mesmos totais de denúncias, de LGBTfobia e de intolerância religiosa. Também comparamos a soma dos microdados com os balanços de LGBTfobia divulgados pelo ministério; a tabela fica no painel do Disque 100.' }),
    ),
    h('div', {},
      h('h3', { class: 'subtitulo', style: 'margin-bottom:8px', texto: 'O que cada selo significa' }),
      h('ul', { class: 'legenda-status' },
        ...['confere', 'fonte-unica', 'estimativa', 'sem-conferencia', 'diverge', 'falha'].map((st) =>
          h('li', {}, icone(st), h('div', {}, h('b', { texto: N.STATUS[st].rotulo }), h('span', { texto: N.STATUS[st].explicacao }))),
        ),
      ),
      h('h3', { class: 'subtitulo', style: 'margin:32px 0 8px', texto: 'Cores das variações' }),
      h('p', { class: 'legenda-painel', style: 'margin-bottom:8px', texto: `${D.indicadores.notaSentido || ''} Em segurança e violência, queda é verde e alta é vermelha. A comparação é sempre com o período anterior: mês, trimestre ou, para Selic e dólar, 30 dias.` }),
      tabela(
        ['Indicador', 'Verde quando'],
        [
          ...Object.values(S).map((s) => [s.nome, { 'maior-melhor': 'sobe', 'menor-melhor': 'cai', neutro: 'sem cor' }[s.sentido] ?? 'sem cor']),
          ['Crimes, mortes violentas e denúncias de violência', 'cai'],
        ],
        'Regra de cor das variações',
      ),
      h('h3', { class: 'subtitulo', style: 'margin:32px 0 8px', texto: 'Fontes' }),
      h('ul', { class: 'fontes-lista' }, fontes.map(([orgao, o, sistema]) => h('li', {}, h('span', {}, h('b', { texto: orgao }), h('br'), o), h('small', { texto: sistema })))),
      E
        ? h('div', { style: 'margin-top:32px' },
            h('h3', { class: 'subtitulo', style: 'margin-bottom:8px', texto: 'Última coleta' }),
            h('p', { class: 'legenda-painel', texto: `Começou em ${dataCurta(E.inicio)} às ${horaBrasilia(E.inicio)} e levou ${E.segundos} segundos: ${E.chamadas} consultas, ${E.falhas} sem resposta, ${E.repeticoes ?? 0} que só responderam na segunda tentativa, ${E.avisos.length} ${E.avisos.length === 1 ? 'aviso' : 'avisos'}.` }),
            E.avisos.length ? h('ul', { class: 'legenda-painel' }, E.avisos.map((a) => h('li', { texto: a.mensagem }))) : null,
            tabela(['Serviço', 'Consultas', 'Repetidas', 'Sem resposta'], (E.fontes || []).map((f) => [f.host, String(f.chamadas), String(f.repeticoes ?? 0), String(f.falhas)]), 'Serviços consultados na última coleta'),
          )
        : null,
    ),
  );

  const site = D.site || {};
  $('rodape').replaceChildren(
    h('div', {},
      h('p', {}, h('b', { texto: `${site.nome || 'Prumo'}. ` }), site.descricao || ''),
      h('p', { style: 'margin-top:8px', texto: site.declaracao || 'Projeto independente, sem vínculo com governos, partidos ou órgãos públicos. Os dados são públicos e podem ser reutilizados citando a fonte original.' }),
    ),
    h('div', {},
      site.repositorio ? h('p', {}, h('a', { href: site.repositorio, texto: 'Código e histórico de dados' })) : null,
      site.contato ? h('p', {}, h('a', { href: `mailto:${site.contato}`, texto: 'Contato e correções' })) : null,
      h('p', { texto: `Dados atualizados em ${dataCurta(D.indicadores.geradoEm)}.` }),
    ),
  );
}

// ---------- Interface ----------

function prepararTema() {
  const raiz = document.documentElement;
  try {
    const salvo = localStorage.getItem('prumo-tema');
    if (salvo) raiz.dataset.theme = salvo;
  } catch {}
  $('tema').addEventListener('click', () => {
    const escuroAgora = raiz.dataset.theme ? raiz.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    raiz.dataset.theme = escuroAgora ? 'light' : 'dark';
    try {
      localStorage.setItem('prumo-tema', raiz.dataset.theme);
    } catch {}
  });
}

function prepararNavegacao() {
  const links = [...document.querySelectorAll('.navegacao a')];
  const obs = new IntersectionObserver(
    (entradas) => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue;
        links.forEach((l) => l.setAttribute('aria-current', String(l.getAttribute('href') === `#${e.target.id}`)));
      }
    },
    { rootMargin: '-40% 0px -55% 0px' },
  );
  document.querySelectorAll('main section[id]').forEach((s) => obs.observe(s));
}

async function iniciar() {
  prepararTema();
  prepararDialogo();
  prepararNavegacao();
  const ok = await carregar();
  if (!ok) return falhaDeCarga();
  const etapas = [
    renderBoletim,
    renderIndicadores,
    renderArrecadacao,
    renderDividas,
    renderGastos,
    function renderSegurancaSecao() {
      renderSeguranca(D);
    },
    renderProgramas,
    renderMandatos,
    function renderSegurancaMandatos() {
      painelSegurancaMandatos(D);
    },
    renderNoticias,
    renderMetodo,
  ];
  for (const etapa of etapas) {
    try {
      etapa();
    } catch (e) {
      console.error(`Falha ao montar ${etapa.name}:`, e);
    }
  }
  const alvo = location.hash.match(/^#indicador=(\w+)/);
  if (alvo) abrirDetalhe(alvo[1]);

  if (coletaDoIbgeFalhou(D.noticias)) {
    D.noticias = { ...D.noticias, ibgeNoNavegador: { estado: 'buscando' } };
    renderNoticias();
    try {
      D.noticias = await buscarIbgeNoNavegador(D.noticias, D.indicadores.series);
    } catch (e) {
      console.warn('Notícias do IBGE indisponíveis no navegador:', e);
      D.noticias = { ...D.noticias, ibgeNoNavegador: { estado: 'falhou' } };
    }
    renderNoticias();
  }
}

iniciar();
