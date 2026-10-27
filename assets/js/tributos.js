// Tributos: quanto a União arrecada em cada um, o catálogo de todos os tributos do país
// (com a situação após a reforma tributária) e o que ainda pode ser criado.

import * as N from './nucleo.js';
import { $, h, alternador } from './dom.js';
import { graficoBarras, graficoLinhas, tabela, botaoTabela } from './graficos.js';

const reais = (v, casas) => N.formatarReais(v, { casas });
const pct = (v) => `${v > 0 ? '+' : ''}${N.formatarNumero(v, 1)}%`;
const conteudo = (...itens) => itens.filter((i) => i != null && i !== false);

const estado = { esfera: 'Todos', aberto: null };

// Soma dos últimos n meses, em reais da época ou corrigidos pelo IPCA até o último índice disponível.
function somaMeses(meses, valores, de, ate, indice) {
  const mapaIndice = indice ? new Map(indice) : null;
  const ultimo = indice?.[indice.length - 1]?.[1];
  let soma = 0;
  for (let i = de; i < ate; i++) {
    const fator = mapaIndice?.get(meses[i]) ? ultimo / mapaIndice.get(meses[i]) : 1;
    soma += valores[i] * fator;
  }
  return soma;
}

// ---------- 1. Arrecadação por tributo ----------

function painelArrecadacao(D) {
  const R = D.tributos?.receita;
  const alvo = $('painel-tributos-arrecadacao');
  if (!R) {
    alvo.replaceChildren(h('p', { class: 'legenda-painel', texto: 'A arrecadação por tributo ainda não foi coletada.' }));
    return;
  }
  const n = R.meses.length;
  const indice = D.indicadores?.auxiliares?.ipcaIndice?.pontos;
  const ultimos = (v) => somaMeses(R.meses, v, n - 12, n, null);
  const reais12 = (v) => somaMeses(R.meses, v, n - 12, n, indice);
  const reaisAnteriores = (v) => somaMeses(R.meses, v, n - 24, n - 12, indice);
  const total12 = ultimos(R.total);
  const itens = R.grupos
    .map((g) => {
      const atual = reais12(g.valores);
      const antes = reaisAnteriores(g.valores);
      const variacao = antes > 0 ? (atual / antes - 1) * 100 : null;
      return { g, rotulo: g.nome, valor: ultimos(g.valores), variacao, dica: variacao == null ? null : `${pct(variacao)} sobre os 12 meses anteriores, descontada a inflação` };
    })
    .sort((a, b) => b.valor - a.valor);
  const inicio = N.rotuloPeriodo(R.meses[n - 12], 'mensal');
  const fim = N.rotuloPeriodo(R.meses[n - 1], 'mensal');
  const graf = h('div');
  const detalhe = h('div');
  const grafMensal = h('div');
  const mostrarPartes = (item) => {
    estado.aberto = item.g.id;
    if (!item.g.partes) {
      detalhe.replaceChildren(h('p', { class: 'legenda-painel', style: 'margin-top:12px', texto: `${item.g.nome}: ${reais(item.valor, 1)} em 12 meses. ${item.dica ?? ''}` }));
      return;
    }
    detalhe.replaceChildren(
      h('h4', { class: 'subtitulo', style: 'margin-top:20px;font-size:var(--texto-m)', texto: `${item.g.nome}: de onde vem` }),
      tabela(
        ['Parte', `${inicio} a ${fim}`, 'Parcela'],
        item.g.partes
          .map((p) => ({ p, v: ultimos(p.valores) }))
          .sort((a, b) => b.v - a.v)
          .map(({ p, v }) => [p.nome, reais(v, 1), `${N.formatarNumero((v / item.valor) * 100, 1)}%`]),
        `Partes do ${item.g.nome}`,
      ),
    );
  };
  alvo.replaceChildren(
    h('div', { class: 'painel__topo' },
      h('div', {},
        h('h3', { class: 'subtitulo', texto: 'Quanto a União arrecada com cada tributo' }),
        h('p', { class: 'legenda-painel', texto: `Total de ${reais(total12, 2)} de ${inicio} a ${fim}, somando todos os estados. Clique em uma barra para ver os detalhes; o Imposto de Renda mostra de onde vem cada parte.` }),
      ),
    ),
    graf,
    detalhe,
    h('h4', { class: 'subtitulo', style: 'margin-top:28px;font-size:var(--texto-m)', texto: 'Arrecadação federal mês a mês' }),
    h('p', { class: 'legenda-painel', texto: 'Em reais da época. Os picos se repetem todo ano em meses de pagamento concentrado de impostos, como janeiro (ajustes anuais das empresas) e abril (declaração do Imposto de Renda).' }),
    grafMensal,
    h('div', { class: 'painel__rodape' },
      h('span', {}, 'Fonte: Receita Federal, arrecadação por estado e tributo. ', h('a', { href: R.url, target: '_blank', rel: 'noopener', texto: 'Arquivo original' })),
      botaoTabela(graf, () =>
        tabela(['Tributo', 'Últimos 12 meses', 'Parcela do total', 'Variação real sobre os 12 meses anteriores'],
          itens.map((i) => [i.rotulo, reais(i.valor, 1), `${N.formatarNumero((i.valor / total12) * 100, 1)}%`, i.variacao == null ? '—' : pct(i.variacao)]),
          'Arrecadação federal por tributo'),
      ),
    ),
  );
  graficoBarras(graf, {
    titulo: 'Arrecadação federal por tributo nos últimos 12 meses',
    itens,
    formato: (v) => `${reais(v, 1)} (${N.formatarNumero((v / total12) * 100, 1)}%)`,
    aoClicar: mostrarPartes,
  });
  const aberto = itens.find((i) => i.g.id === estado.aberto);
  if (aberto) mostrarPartes(aberto);
  graficoLinhas(grafMensal, {
    titulo: 'Arrecadação federal mensal',
    series: [{ nome: 'Arrecadação federal', cor: 'var(--serie-1)', pontos: R.meses.map((m, i) => [N.indiceMes(m), R.total[i]]) }],
    altura: 220,
    incluirZero: true,
    area: true,
    marcasX: (xMin, xMax) => {
      const marcas = [];
      for (let x = Math.ceil(xMin / 6) * 6; x <= xMax; x += 6) {
        const p = N.periodoDeIndice(x);
        marcas.push({ x, rotulo: `${N.MESES_CURTOS[Number(p.slice(5)) - 1]}/${p.slice(2, 4)}` });
      }
      return marcas;
    },
    formatoEixo: (v) => (v >= 1e9 ? `${N.formatarNumero(v / 1e9, 0)} bi` : N.formatarNumero(v, 0)),
    formatoRotulo: (v) => reais(v, 1),
    formatoDica: (v) => reais(v, 2),
    rotuloX: (x) => N.rotuloPeriodo(N.periodoDeIndice(x), 'mensal', { longo: true }),
  });
}

// ---------- 2. Catálogo ----------

const ETAPAS_REFORMA = [
  ['2026', 'Teste: CBS de 0,9% e IBS de 0,1%, com o valor compensado no PIS e na Cofins.'],
  ['2027', 'CBS cobrada integralmente; PIS e Cofins deixam de existir; começa o Imposto Seletivo; IPI vai a zero, exceto para produtos que também são fabricados na Zona Franca de Manaus.'],
  ['2029 a 2032', 'ICMS e ISS diminuem a cada ano (para 90%, 80%, 70% e 60% das alíquotas) enquanto o IBS aumenta.'],
  ['2033', 'ICMS e ISS deixam de existir; o IBS passa a ser cobrado integralmente.'],
];

const ROTULOS_ESFERA = { Todos: 'Todos', Federal: 'Federais', Estadual: 'Estaduais', Municipal: 'Municipais', 'Estadual e municipal': 'Compartilhados' };

function etiquetaSituacao(config, item) {
  const texto = config.situacoes[item.situacao] ?? item.situacao;
  const extra = item.situacao === 'em-extincao' && item.ate ? ` em ${item.ate}` : item.situacao === 'futuro' && item.desde ? ` em ${item.desde}` : '';
  return h('span', { class: `etiqueta etiqueta--situacao-${item.situacao}`, texto: `${texto}${extra}` });
}

function painelCatalogo(D) {
  const C = D.configTributos;
  const R = D.tributos?.receita;
  const alvo = $('painel-tributos-catalogo');
  if (!C) return;
  const n = R?.meses.length ?? 0;
  const arrecadado12 = (id) => {
    const g = R?.grupos.find((x) => x.id === id);
    return g ? somaMeses(R.meses, g.valores, n - 12, n, null) : null;
  };
  const esferas = Object.keys(ROTULOS_ESFERA);
  const filtrados = C.catalogo.filter((t) => estado.esfera === 'Todos' || t.esfera === estado.esfera || (estado.esfera !== 'Estadual e municipal' && t.esfera.includes('Federal, estadual e municipal')));
  const lei = (id) => (id && C.leis[id] ? h('a', { href: C.leis[id].url, target: '_blank', rel: 'noopener', texto: C.leis[id].nome }) : null);
  alvo.replaceChildren(
    h('div', { class: 'painel__topo' },
      h('div', {},
        h('h3', { class: 'subtitulo', texto: 'Todos os tributos do país' }),
        h('p', { class: 'legenda-painel', texto: 'Impostos, contribuições e taxas cobrados pela União, pelos estados e pelos municípios, o que cada um tributa e o que muda com a reforma tributária. Os valores arrecadados aparecem para os tributos federais.' }),
      ),
    ),
    h('ol', { class: 'linha-tempo', 'aria-label': 'Etapas da reforma tributária' },
      ETAPAS_REFORMA.map(([quando, texto]) => h('li', {}, h('b', { texto: quando }), h('span', { texto }))),
    ),
    h('div', { class: 'controles', style: 'margin-top:20px' },
      alternador('Esfera', esferas.map((e) => [e, ROTULOS_ESFERA[e]]), estado.esfera, (v) => {
        estado.esfera = v;
        painelCatalogo(D);
      }),
    ),
    h('ul', { class: 'lista-tributos', 'data-limite': '6', 'data-rotulo': 'Ver todos os {n} tributos' },
      filtrados.map((t) => {
        const valor = t.receita ? arrecadado12(t.receita) : null;
        return h('li', { class: 'tributo' },
          h('div', { class: 'tributo__cabeca' },
            h('b', { class: 'tributo__sigla', texto: t.sigla }),
            h('span', { class: 'tributo__nome', texto: t.nome !== t.sigla ? t.nome : '' }),
          ),
          h('p', { class: 'tributo__incide', texto: t.incide }),
          t.detalhe ? h('p', { class: 'tributo__detalhe', texto: t.detalhe }) : null,
          h('div', { class: 'programa__meta' },
            etiquetaSituacao(C, t),
            h('span', { texto: `${t.esfera}, ${t.tipo.toLowerCase()}` }),
            valor ? h('span', { texto: `Arrecadou ${reais(valor, 1)} em 12 meses` }) : null,
            h('span', { texto: t.base }),
            lei(t.lei),
          ),
        );
      }),
    ),
    h('div', { class: 'painel__rodape' },
      h('span', {}, 'Base legal: ', lei('constituicao'), ', ', lei('ec132'), ' e ', lei('lc214'), '.'),
    ),
  );
}

// ---------- 3. O que pode ser criado ----------

const SITUACOES_PROPOSTA = [
  [/Transformad[oa] em Norma Jurídica/i, 'Virou lei', 'lei'],
  [/Retirad/i, 'Retirada pelo autor', 'encerrada'],
  [/Arquivad/i, 'Arquivada', 'encerrada'],
  [/Perdeu a Eficácia|Prejudicad|Rejeitad/i, 'Encerrada sem aprovação', 'encerrada'],
];

function situacaoProposta(texto) {
  for (const [re, rotulo, grupo] of SITUACOES_PROPOSTA) if (re.test(texto || '')) return { rotulo, grupo };
  return { rotulo: texto ? `Em tramitação: ${texto.charAt(0).toLowerCase()}${texto.slice(1)}` : 'Em tramitação', grupo: 'tramitacao' };
}

function painelNovos(D) {
  const C = D.configTributos;
  const P = D.tributos?.propostas;
  const alvo = $('painel-tributos-novos');
  if (!C) return;
  const itens = (P?.itens || []).map((i) => ({ ...i, s: situacaoProposta(i.situacao) }));
  const contar = (g) => itens.filter((i) => i.s.grupo === g).length;
  alvo.replaceChildren(...conteudo(
    h('div', { class: 'painel__topo' },
      h('div', {},
        h('h3', { class: 'subtitulo', texto: 'Tributos que podem ser criados' }),
        h('p', { class: 'legenda-painel', texto: 'O que a Constituição permite criar e os projetos no Congresso que propõem tributos novos.' }),
      ),
    ),
    h('h4', { class: 'subtitulo', style: 'font-size:var(--texto-m)', texto: 'O que a Constituição permite' }),
    h('ul', { class: 'lista-tributos' },
      C.podemSerCriados.map((t) =>
        h('li', { class: 'tributo' },
          h('div', { class: 'tributo__cabeca' }, h('b', { class: 'tributo__sigla', texto: t.sigla }), h('span', { class: 'tributo__nome', texto: t.nome })),
          h('p', { class: 'tributo__incide', texto: t.explicacao }),
          h('div', { class: 'programa__meta' }, etiquetaSituacao(C, t), h('span', { texto: t.base })),
        ),
      ),
    ),
    P
      ? h('div', { style: 'margin-top:28px' },
          h('h4', { class: 'subtitulo', style: 'font-size:var(--texto-m)', texto: `Propostas na Câmara desde ${P.desde}` }),
          h('p', { class: 'legenda-painel', texto: `${P.nota} ${contar('tramitacao')} em tramitação, ${contar('lei')} ${contar('lei') === 1 ? 'virou lei' : 'viraram lei'} e ${contar('encerrada')} ${contar('encerrada') === 1 ? 'foi encerrada' : 'foram encerradas'}.` }),
          h('ul', { class: 'lista-programas', 'data-limite': '4', 'data-rotulo': 'Ver as {n} propostas' },
            itens.map((i) =>
              h('li', { class: 'programa' },
                h('div', {},
                  h('div', { class: 'programa__id', texto: `${i.siglaTipo} ${N.formatarNumero(i.numero, 0)}/${i.ano}` }),
                  h('div', { class: 'programa__data', texto: i.dataApresentacao ? `Apresentada em ${N.rotuloPeriodo(i.dataApresentacao, 'diaria')}` : '' }),
                ),
                h('div', {},
                  h('p', { class: 'programa__ementa', texto: i.ementa.split(/\s*NOVA EMENTA:\s*/i)[0] }),
                  h('div', { class: 'programa__meta' },
                    h('span', { class: `etiqueta etiqueta--proposta-${i.s.grupo}`, texto: i.s.rotulo }),
                    h('span', { texto: i.especie.charAt(0).toUpperCase() + i.especie.slice(1) }),
                    h('a', { href: i.link, target: '_blank', rel: 'noopener', texto: 'Ficha na Câmara' }),
                  ),
                ),
              ),
            ),
          ),
        )
      : null,
    h('div', { class: 'painel__rodape' },
      h('span', { texto: 'Fontes: Constituição Federal e Dados Abertos da Câmara dos Deputados. A lista de propostas é atualizada todos os dias; propostas do Senado não estão incluídas.' }),
    ),
  ));
}

export function renderTributos(D) {
  painelArrecadacao(D);
  painelCatalogo(D);
  painelNovos(D);
}

