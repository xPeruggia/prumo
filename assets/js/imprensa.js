// Capítulo "Como a imprensa contou": o mesmo fato em vários veículos, lado a lado.
// O site não classifica veículos nem julga o conteúdo; mostra o que cada um escreveu, destaca as palavras
// que só aquele veículo usou no título e marca colunas e análises conforme a seção em que foram publicadas.

import * as N from './nucleo.js';
import { $, h, alternador, selo } from './dom.js';

const TIPOS = { coluna: 'Coluna ou opinião', analise: 'Análise' };
const estado = { assunto: 'todos' };

const horaCurta = (iso) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
    .format(new Date(iso))
    .replace(', ', ' às ');

function titulo(m) {
  return h('h4', { class: 'materia__titulo' },
    (m.tituloMarcado || [[m.titulo, false]]).map(([texto, exclusivo]) => (exclusivo ? h('mark', { class: 'exclusiva', texto }) : texto)),
  );
}

function checagem(num) {
  if (!num) return null;
  if (num.ok === true) return selo('confere', num.nota);
  if (num.ok === false) return selo('diverge', num.nota);
  return selo('sem-conferencia', num.nota);
}

function cartao(m, nomes) {
  return h('article', { class: 'materia' },
    h('div', { class: 'materia__topo' },
      h('b', { class: 'materia__veiculo', texto: nomes[m.veiculo] || m.veiculo }),
      h('span', { class: 'materia__hora', texto: horaCurta(m.publicadoEm) }),
    ),
    TIPOS[m.tipo] ? h('span', { class: 'etiqueta etiqueta--tipo', texto: TIPOS[m.tipo] }) : null,
    titulo(m),
    m.trecho ? h('p', { class: 'materia__trecho', texto: m.trecho }) : null,
    checagem(m.numero),
    h('a', { class: 'materia__link', href: m.link, target: '_blank', rel: 'noopener', texto: `Ler no ${nomes[m.veiculo] || m.veiculo}` }),
  );
}

function comparacao(g, nomes) {
  const periodo = g.primeiro === g.ultimo ? `em ${horaCurta(g.primeiro)}` : `entre ${horaCurta(g.primeiro)} e ${horaCurta(g.ultimo)}`;
  return h('li', { class: 'comparacao' },
    h('div', { class: 'comparacao__topo' },
      h('p', { class: 'comparacao__comuns' },
        h('span', { class: 'comparacao__rotulo', texto: 'Em comum nos títulos' }),
        g.comuns.map((p) => h('span', { class: 'etiqueta', texto: p })),
      ),
      h('p', { class: 'comparacao__meta' },
        `${g.veiculos} veículos, ${periodo}`,
        g.politica ? h('span', { class: 'etiqueta etiqueta--politica', title: `Termo da lista pública do filtro: "${g.politica}"`, texto: 'Política partidária' }) : null,
      ),
    ),
    h('div', { class: 'comparacao__materias' }, g.materias.map((m) => cartao(m, nomes))),
  );
}

export function renderImprensa(D) {
  const I = D.imprensa;
  const lista = $('lista-comparacoes');
  if (!lista) return;
  if (!I?.comparacoes?.length) {
    $('controles-imprensa').replaceChildren();
    lista.replaceChildren(h('li', { class: 'legenda-painel', texto: 'Nenhum fato foi publicado por três ou mais veículos nas últimas horas. A comparação volta na próxima coleta.' }));
    return;
  }
  const nomes = Object.fromEntries(I.veiculos.map((v) => [v.id, v.nome]));
  const semPolitica = I.comparacoes.filter((g) => !g.politica);
  const visiveis = estado.assunto === 'sem-politica' ? semPolitica : I.comparacoes;

  $('controles-imprensa').replaceChildren(
    h('div', {},
      alternador('Assuntos', [['todos', `Todos os assuntos (${I.comparacoes.length})`], ['sem-politica', `Sem política partidária (${semPolitica.length})`]], estado.assunto, (v) => {
        estado.assunto = v;
        lista.dataset.aberto = 'nao';
        renderImprensa(D);
      }),
    ),
    h('p', { class: 'legenda-painel' }, h('mark', { class: 'exclusiva', texto: 'Destaque' }), ': palavras que só aquele veículo usou no título.'),
  );
  lista.replaceChildren(...visiveis.map((g) => comparacao(g, nomes)));

  const ok = I.veiculos.filter((v) => v.ok);
  const fora = I.veiculos.filter((v) => !v.ok);
  $('imprensa-veiculos').replaceChildren(
    `Veículos consultados nas últimas ${I.janelaHoras} horas, com o número de matérias lidas: `,
    ok.map((v) => `${v.nome} (${v.materias})`).join(', '),
    '.',
    fora.length ? ` Sem resposta nesta coleta: ${fora.map((v) => v.nome).join(', ')}.` : '',
    ` Atualizado em ${N.rotuloPeriodo(I.geradoEm.slice(0, 10), 'diaria')}.`,
  );
}
