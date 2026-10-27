// Leitura em camadas: o essencial fica à vista e o detalhe, a um clique. Nada é retirado da página.
// - textos longos aparecem nas primeiras linhas, com "Ver mais";
// - notas de rodapé dos painéis ficam recolhidas em "Notas e fontes";
// - listas longas mostram os primeiros itens, com "Mostrar todos";
// - o texto do método vira tópicos que abrem um de cada vez;
// - a legenda dos símbolos acompanha a leitura, fixa na parte de baixo da tela.
// Tudo é aplicado também ao que as seções redesenham depois (troca de filtro, câmbio ao vivo).

import { h, icone } from './dom.js';
import { STATUS } from './nucleo.js';

const RESUMIVEIS = '.legenda-painel, .noticia__resumo, .tributo__detalhe, .programa__ementa';
const LIMITE_TEXTO = 200; // caracteres a partir dos quais um texto aparece resumido
let sequencia = 0;

function resumirTexto(p) {
  if (p.dataset.leitura || p.textContent.length < LIMITE_TEXTO || p.closest('details, dialog')) return;
  p.dataset.leitura = 'resumido';
  if (!p.id) p.id = `texto-${++sequencia}`;
  p.classList.add('recolhivel');
  const botao = h('button', { type: 'button', class: 'ver-mais-botao', 'aria-expanded': 'false', 'aria-controls': p.id }, 'Ver mais');
  botao.addEventListener('click', () => {
    const aberto = p.classList.toggle('aberto');
    botao.setAttribute('aria-expanded', String(aberto));
    botao.textContent = aberto ? 'Ver menos' : 'Ver mais';
  });
  p.after(botao);
  // Se o texto já cabe nas linhas visíveis, não há o que abrir.
  requestAnimationFrame(() => {
    if (p.offsetParent && p.scrollHeight <= p.clientHeight + 2) {
      p.classList.remove('recolhivel');
      botao.remove();
    }
  });
}

function recolherNotas(bloco) {
  if (bloco.closest('details') || !bloco.textContent.trim()) return;
  const caixa = h('details', { class: 'ver-mais ver-mais--notas' }, h('summary', {}, 'Notas e fontes'));
  bloco.replaceWith(caixa);
  caixa.append(bloco);
}

function limitarLista(lista) {
  const limite = Number(lista.dataset.limite);
  const itens = [...lista.children];
  let botao = lista.nextElementSibling?.classList.contains('mostrar-todos') ? lista.nextElementSibling : null;
  if (itens.length <= limite) {
    itens.forEach((li) => li.classList.remove('alem-do-limite'));
    botao?.remove();
    return;
  }
  const aberto = lista.dataset.aberto === 'sim';
  itens.forEach((li, i) => li.classList.toggle('alem-do-limite', !aberto && i >= limite));
  if (!botao) {
    botao = h('button', { type: 'button', class: 'mostrar-todos' });
    botao.addEventListener('click', () => {
      lista.dataset.aberto = lista.dataset.aberto === 'sim' ? 'nao' : 'sim';
      limitarLista(lista);
      if (lista.dataset.aberto === 'nao') lista.scrollIntoView({ block: 'nearest' });
    });
    lista.after(botao);
  }
  const texto = aberto ? 'Mostrar menos' : (lista.dataset.rotulo || 'Mostrar todos ({n})').replace('{n}', itens.length);
  if (botao.textContent !== texto) botao.textContent = texto;
  botao.setAttribute('aria-expanded', String(aberto));
}

function processar(no, listas) {
  if (!(no instanceof Element)) return;
  const achar = (sel) => [...(no.matches(sel) ? [no] : []), ...no.querySelectorAll(sel)];
  achar(RESUMIVEIS).forEach(resumirTexto);
  achar('.notas-painel').forEach(recolherNotas);
  achar('[data-limite]').forEach((l) => listas.add(l));
  const mae = no.parentElement?.closest('[data-limite]');
  if (mae) listas.add(mae);
}

export function prepararLeitura(raiz = document.querySelector('main')) {
  const aplicar = (nos) => {
    const listas = new Set();
    nos.forEach((n) => processar(n, listas));
    listas.forEach(limitarLista);
  };
  new MutationObserver((mudancas) => aplicar(mudancas.flatMap((m) => [...m.addedNodes]))).observe(raiz, { childList: true, subtree: true });
  aplicar([raiz]);
}

// Agrupa um texto corrido em tópicos: cada <h3> e o que vem até o próximo viram um item que abre e fecha.
export function acordeao(prosa) {
  if (!prosa) return;
  const filhos = [...prosa.children];
  const grupos = [];
  for (const el of filhos) {
    if (el.tagName === 'H3') grupos.push({ titulo: el, corpo: [] });
    else if (grupos.length) grupos.at(-1).corpo.push(el);
  }
  if (!grupos.length) return;
  prosa.classList.add('prosa--topicos');
  prosa.replaceChildren(
    ...grupos.map(({ titulo, corpo }) =>
      h('details', { class: 'topico' },
        h('summary', {}, h('span', { class: 'topico__titulo', texto: titulo.textContent })),
        h('div', { class: 'topico__corpo' }, corpo),
      ),
    ),
  );
}

// Legenda fixa dos símbolos usados no site. Aparece depois da abertura (onde a conferência do dia já os
// explica) e pode ser recolhida; a escolha fica guardada no navegador.
export function montarLegendaFixa() {
  const ordem = ['confere', 'fonte-unica', 'estimativa', 'sem-conferencia', 'diverge', 'falha'];
  let recolhida = matchMedia('(max-width: 760px)').matches;
  try {
    const salvo = localStorage.getItem('quadro-real-legenda');
    if (salvo) recolhida = salvo === 'recolhida';
  } catch {}

  const lista = h('ul', { class: 'legenda-fixa__lista', id: 'legenda-fixa-lista' },
    ordem.map((st) => h('li', { title: STATUS[st].explicacao }, icone(st), h('span', { texto: STATUS[st].curto }))),
    h('li', { class: 'legenda-fixa__cor', title: 'Variação no sentido geralmente considerado favorável para aquele indicador.' },
      h('span', { class: 'tendencia tendencia--favoravel', 'aria-hidden': 'true', texto: '▲▼' }), h('span', { texto: 'Melhorou' })),
    h('li', { class: 'legenda-fixa__cor', title: 'Variação no sentido geralmente considerado desfavorável para aquele indicador.' },
      h('span', { class: 'tendencia tendencia--desfavoravel', 'aria-hidden': 'true', texto: '▲▼' }), h('span', { texto: 'Piorou' })),
    h('li', { class: 'legenda-fixa__link' }, h('a', { href: '#metodo', texto: 'O que cada símbolo quer dizer' })),
  );
  const alternar = h('button', { type: 'button', class: 'legenda-fixa__alternar', 'aria-controls': 'legenda-fixa-lista' });
  const caixa = h('aside', { class: 'legenda-fixa', 'aria-label': 'Legenda dos símbolos' }, alternar, lista);

  const aplicar = () => {
    caixa.classList.toggle('legenda-fixa--recolhida', recolhida);
    alternar.setAttribute('aria-expanded', String(!recolhida));
    alternar.setAttribute('aria-label', recolhida ? 'Mostrar a legenda dos símbolos' : 'Recolher a legenda dos símbolos');
    alternar.replaceChildren(icone('confere'), h('span', { texto: 'Legenda' }));
  };
  alternar.addEventListener('click', () => {
    recolhida = !recolhida;
    aplicar();
    try {
      localStorage.setItem('quadro-real-legenda', recolhida ? 'recolhida' : 'aberta');
    } catch {}
  });
  aplicar();
  document.body.append(caixa);

  const abertura = document.querySelector('.conferencia');
  if (abertura) {
    new IntersectionObserver(([e]) => caixa.classList.toggle('legenda-fixa--visivel', !e.isIntersecting && e.boundingClientRect.top < 0)).observe(abertura);
  } else {
    caixa.classList.add('legenda-fixa--visivel');
  }
}
