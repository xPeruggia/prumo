// Utilidades de interface compartilhadas pelas seções do site.
import { STATUS } from './nucleo.js';

const NS = 'http://www.w3.org/2000/svg';

export const $ = (id) => document.getElementById(id);

export function h(tag, props = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'texto') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat(Infinity)) if (f != null && f !== false) n.append(f instanceof Node ? f : String(f));
  return n;
}

const ICONES = {
  confere: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7.5 12.3l3 3 6-6.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  'fonte-unica': '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
  'sem-conferencia': '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/>',
  diverge: '<path d="M12 3.5l9.5 16.5h-19z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10v4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.1" fill="currentColor"/>',
  falha: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  estimativa: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2 2.4"/><path d="M7.5 10.5c1.5-1.4 3-1.4 4.5 0s3 1.4 4.5 0M7.5 14.5c1.5-1.4 3-1.4 4.5 0s3 1.4 4.5 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
};

export function icone(status) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', `icone-status icone-status--${status}`);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONES[status] || ICONES['fonte-unica'];
  return s;
}

export function selo(status, texto) {
  return h('span', { class: `selo selo--${status}` }, icone(status), texto ?? STATUS[status]?.curto ?? status);
}

export function alternador(rotuloGrupo, opcoes, atual, aoMudar) {
  const grupo = h('div', { class: 'alternador', role: 'group', 'aria-label': rotuloGrupo });
  for (const [valor, texto, desativado] of opcoes) {
    grupo.append(
      h('button', {
        type: 'button',
        'aria-pressed': String(valor === atual),
        disabled: desativado || null,
        texto,
        onclick: () => aoMudar(valor),
      }),
    );
  }
  return grupo;
}

// Lista de opções; grupos: [{ rotulo, opcoes: [[valor, texto]] }] ou opções soltas [[valor, texto]].
export function seletor(rotulo, grupos, atual, aoMudar) {
  const sel = h('select', { class: 'seletor', 'aria-label': rotulo, onchange: (e) => aoMudar(e.target.value) });
  const opcao = ([valor, texto]) => h('option', { value: valor, selected: valor === atual || null, texto });
  for (const g of grupos) {
    if (Array.isArray(g)) sel.append(opcao(g));
    else sel.append(h('optgroup', { label: g.rotulo }, g.opcoes.map(opcao)));
  }
  return sel;
}
