// Gráficos em SVG puro, sem bibliotecas externas.
// Regras: um único eixo Y, linhas de 2 px, grade discreta, rótulo direto só no último ponto,
// dica (tooltip) com todas as séries no mesmo X e tabela equivalente para leitura sem mouse.

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, pai) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  if (pai) pai.appendChild(n);
  return n;
}

function texto(pai, conteudo, attrs) {
  const t = el('text', attrs, pai);
  t.textContent = conteudo;
  return t;
}

// ---------- Dica compartilhada ----------

let dica;
function obterDica() {
  if (!dica) {
    dica = document.createElement('div');
    dica.className = 'dica';
    dica.setAttribute('role', 'status');
    dica.hidden = true;
    document.body.appendChild(dica);
  }
  return dica;
}

export function mostrarDica(clienteX, clienteY, titulo, linhas) {
  const d = obterDica();
  // Um diálogo aberto fica numa camada que o navegador desenha acima de toda a página;
  // para aparecer na frente do gráfico ampliado, a dica precisa morar dentro dele.
  const hospedeiro = document.querySelector('dialog[open]') || document.body;
  if (d.parentElement !== hospedeiro) hospedeiro.appendChild(d);
  d.replaceChildren();
  const t = document.createElement('div');
  t.className = 'dica__titulo';
  t.textContent = titulo;
  d.appendChild(t);
  for (const l of linhas) {
    const linha = document.createElement('div');
    linha.className = 'dica__linha';
    if (l.cor) {
      const i = document.createElement('i');
      i.style.background = l.cor;
      linha.appendChild(i);
    }
    const b = document.createElement('b');
    b.textContent = l.valor;
    linha.appendChild(b);
    if (l.nome) {
      const s = document.createElement('span');
      s.textContent = l.nome;
      linha.appendChild(s);
    }
    d.appendChild(linha);
  }
  d.hidden = false;
  const r = d.getBoundingClientRect();
  let x = clienteX + 14;
  let y = clienteY - r.height - 12;
  if (x + r.width > window.innerWidth - 8) x = clienteX - r.width - 14;
  if (y < 8) y = clienteY + 16;
  x = Math.max(8, x);
  d.style.left = `${x}px`;
  d.style.top = `${y}px`;
  // Se algum elemento acima da dica mudar a referência da posição fixa, corrige pela diferença medida.
  const real = d.getBoundingClientRect();
  if (Math.abs(real.left - x) > 0.5 || Math.abs(real.top - y) > 0.5) {
    d.style.left = `${2 * x - real.left}px`;
    d.style.top = `${2 * y - real.top}px`;
  }
}

export function esconderDica() {
  if (dica) dica.hidden = true;
}

// ---------- Escalas ----------

function passoLimpo(intervalo, alvo) {
  const bruto = intervalo / alvo;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const n = bruto / potencia;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * potencia;
}

function marcasY(min, max, alvo = 4) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const passo = passoLimpo(max - min, alvo);
  const ini = Math.floor(min / passo) * passo;
  const fim = Math.ceil(max / passo) * passo;
  const marcas = [];
  for (let v = ini; v <= fim + passo / 2; v += passo) marcas.push(Number(v.toFixed(10)));
  return { min: ini, max: fim, marcas };
}

function redesenharAoRedimensionar(container, desenhar) {
  let largura = 0;
  let pendente;
  const ro = new ResizeObserver(() => {
    const w = Math.round(container.clientWidth);
    if (w === largura || w === 0) return;
    largura = w;
    cancelAnimationFrame(pendente);
    pendente = requestAnimationFrame(() => desenhar(w));
  });
  ro.observe(container);
  container._parar?.();
  container._parar = () => ro.disconnect();
}

// ---------- Linhas ----------
// series: [{ nome, cor, pontos: [[x, y]] }] com x numérico (índice de mês).
// faixas: [{ rotulo, de, ate }] em x, desenhadas atrás das linhas.

export function graficoLinhas(container, op) {
  const altura = op.altura ?? 260;
  container.classList.add('grafico');
  container.setAttribute('role', 'figure');
  if (op.titulo) container.setAttribute('aria-label', op.titulo);

  redesenharAoRedimensionar(container, (largura) => {
    container.replaceChildren();
    const series = op.series.filter((s) => s.pontos.length);
    if (!series.length) {
      const p = document.createElement('p');
      p.className = 'legenda-painel';
      p.textContent = op.vazio ?? 'Ainda não há dados para este período.';
      container.appendChild(p);
      return;
    }
    const estreito = largura < 520;
    const espacoSeta = series.some((s) => s.tendencia) ? 16 : 0;
    const m = { topo: op.faixas?.length ? 24 : 10, dir: op.rotuloFinal === false ? 12 : (estreito ? 54 : 70) + espacoSeta, base: 26, esq: op.margemEsq ?? 44 };
    const svg = el('svg', { viewBox: `0 0 ${largura} ${altura}`, height: altura, tabindex: 0, 'aria-hidden': 'false' }, container);
    const titulo = el('title', {}, svg);
    titulo.textContent = op.titulo || '';

    const xs = [...new Set(series.flatMap((s) => s.pontos.map((p) => p[0])))].sort((a, b) => a - b);
    const xMin = op.dominioX?.[0] ?? xs[0];
    const xMax = op.dominioX?.[1] ?? xs[xs.length - 1];
    let yMin = Math.min(...series.flatMap((s) => s.pontos.map((p) => p[1])));
    let yMax = Math.max(...series.flatMap((s) => s.pontos.map((p) => p[1])));
    if (op.incluirZero) {
      yMin = Math.min(0, yMin);
      yMax = Math.max(0, yMax);
    }
    const folga = (yMax - yMin) * 0.06 || 1;
    const esc = marcasY(op.incluirZero && yMin >= 0 ? 0 : yMin - folga, yMax + folga, estreito ? 3 : 4);
    const px = (x) => m.esq + ((x - xMin) / Math.max(1, xMax - xMin)) * (largura - m.esq - m.dir);
    const py = (y) => m.topo + (1 - (y - esc.min) / (esc.max - esc.min)) * (altura - m.topo - m.base);

    // Faixas de mandato
    if (op.faixas) {
      const g = el('g', {}, svg);
      op.faixas.forEach((f, i) => {
        const de = Math.max(f.de, xMin);
        const ate = Math.min(f.ate, xMax);
        if (ate <= de) return;
        if (i % 2 === 1) el('rect', { class: 'faixa-mandato', x: px(de), y: m.topo, width: px(ate) - px(de), height: altura - m.topo - m.base }, g);
        if (px(ate) - px(de) > 54) texto(g, f.rotulo, { class: 'rotulo-mandato', x: px(de) + 6, y: m.topo - 8 });
      });
    }

    // Grade e eixo Y
    const grade = el('g', { class: 'grade' }, svg);
    const eixo = el('g', { class: 'eixo' }, svg);
    for (const v of esc.marcas) {
      el('line', { x1: m.esq, x2: largura - m.dir + 8, y1: py(v), y2: py(v), class: v === 0 ? 'base' : null }, grade);
      texto(eixo, op.formatoEixo ? op.formatoEixo(v) : String(v), { x: m.esq - 8, y: py(v) + 4, 'text-anchor': 'end' });
    }

    // Eixo X
    const marcasX = op.marcasX ? op.marcasX(xMin, xMax, largura) : [];
    for (const { x, rotulo } of marcasX) {
      if (x < xMin || x > xMax) continue;
      texto(eixo, rotulo, { x: px(x), y: altura - 6, 'text-anchor': 'middle' });
    }

    // Linhas
    for (const s of series) {
      const d = s.pontos.map(([x, y], i) => `${i ? 'L' : 'M'}${px(x).toFixed(1)},${py(y).toFixed(1)}`).join('');
      if (op.area && series.length === 1) {
        const base = py(Math.max(esc.min, Math.min(0, esc.max)));
        const ultimo = s.pontos[s.pontos.length - 1];
        el('path', { class: 'area-serie', d: `${d}L${px(ultimo[0])},${base}L${px(s.pontos[0][0])},${base}Z`, fill: s.lavagem || 'var(--serie-1-lavagem)' }, svg);
      }
      el('path', { class: `linha-serie${s.fraco ? ' linha-serie--fraca' : ''}`, d, stroke: s.fraco ? 'var(--tinta-3)' : s.cor }, svg);
    }

    // Pontos e rótulos finais (afastados quando colidem); séries de contexto sem rótulo não entram
    if (op.rotuloFinal !== false) {
      const finais = series.filter((s) => s.rotulo !== false).map((s) => {
        const [x, y] = s.pontos[s.pontos.length - 1];
        return { s, x: px(x), y: py(y), alvo: py(y), valor: y };
      });
      finais.sort((a, b) => a.y - b.y);
      for (let i = 1; i < finais.length; i++) {
        if (finais[i].alvo - finais[i - 1].alvo < 16) finais[i].alvo = finais[i - 1].alvo + 16;
      }
      for (const f of finais) {
        if (Math.abs(f.alvo - f.y) > 2) el('line', { x1: f.x + 5, y1: f.y, x2: f.x + 9, y2: f.alvo, stroke: 'var(--linha-forte)' }, svg);
        el('circle', { class: 'ponto-final', cx: f.x, cy: f.y, r: 4.5, fill: f.s.fraco ? 'var(--tinta-3)' : f.s.cor }, svg);
        const rotulo = texto(svg, op.formatoRotulo ? op.formatoRotulo(f.valor, f.s) : String(f.valor), {
          class: `rotulo-final${f.s.fraco ? ' rotulo-final--fraco' : ''}`,
          x: f.x + 10,
          y: f.alvo + 4,
        });
        // Seta da variação sobre o ponto anterior, colorida pelo sentido do indicador.
        if (f.s.tendencia) {
          const seta = el('tspan', { class: `seta-tendencia seta-tendencia--${f.s.tendencia.tom}`, dx: 4 }, rotulo);
          seta.textContent = { sobe: '▲', desce: '▼', igual: '▬' }[f.s.tendencia.direcao];
        }
      }
    }

    // Camada de interação: mira vertical que procura o X mais próximo
    const mira = el('line', { class: 'mira', y1: m.topo, y2: altura - m.base, visibility: 'hidden' }, svg);
    const corDe = (s) => (s.fraco ? 'var(--tinta-3)' : s.cor);
    const marcadores = series.map((s) => el('circle', { r: s.fraco ? 3 : 4, fill: corDe(s), stroke: 'var(--superficie-solida)', 'stroke-width': 2, visibility: 'hidden' }, svg));
    const zona = el('rect', { class: 'zona-toque', x: m.esq, y: 0, width: largura - m.esq - m.dir + 8, height: altura }, svg);
    let indice = xs.length - 1;

    const mapas = series.map((s) => new Map(s.pontos));
    const valorEm = (s, x) => mapas[series.indexOf(s)].get(x) ?? null;

    const mostrar = (i, cx, cy) => {
      indice = Math.max(0, Math.min(xs.length - 1, i));
      const x = xs[indice];
      mira.setAttribute('x1', px(x));
      mira.setAttribute('x2', px(x));
      mira.setAttribute('visibility', 'visible');
      const linhas = [];
      series.forEach((s, j) => {
        const v = valorEm(s, x);
        if (v == null) {
          marcadores[j].setAttribute('visibility', 'hidden');
          return;
        }
        marcadores[j].setAttribute('cx', px(x));
        marcadores[j].setAttribute('cy', py(v));
        marcadores[j].setAttribute('visibility', 'visible');
        linhas.push({ cor: corDe(s), valor: op.formatoDica ? op.formatoDica(v, s) : String(v), nome: series.length > 1 ? s.nome : null });
      });
      const caixa = svg.getBoundingClientRect();
      const escala = caixa.width / largura;
      mostrarDica(cx ?? caixa.left + px(x) * escala, cy ?? caixa.top + m.topo * escala + 20, op.rotuloX ? op.rotuloX(x) : String(x), linhas);
    };

    const esconder = () => {
      mira.setAttribute('visibility', 'hidden');
      marcadores.forEach((c) => c.setAttribute('visibility', 'hidden'));
      esconderDica();
    };

    zona.addEventListener('pointermove', (e) => {
      const caixa = svg.getBoundingClientRect();
      const xSvg = ((e.clientX - caixa.left) / caixa.width) * largura;
      const xVal = xMin + ((xSvg - m.esq) / (largura - m.esq - m.dir)) * (xMax - xMin);
      let melhor = 0;
      for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - xVal) < Math.abs(xs[melhor] - xVal)) melhor = i;
      mostrar(melhor, e.clientX, e.clientY);
    });
    zona.addEventListener('pointerleave', esconder);
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        mostrar(indice + (e.key === 'ArrowLeft' ? -1 : 1));
      } else if (e.key === 'Escape') esconder();
    });
    svg.addEventListener('focus', () => mostrar(indice));
    svg.addEventListener('blur', esconder);
  });
}

// Rótulo de categoria que quebra em duas linhas quando não cabe, em vez de ser cortado.
function rotuloQuebrado(svg, conteudo, x, meio, limite) {
  const t = texto(svg, conteudo, { class: 'rotulo-categoria', x, y: meio + 4.5, 'text-anchor': 'end' });
  if (t.getComputedTextLength() <= limite) return;
  const palavras = conteudo.split(' ');
  let corte = palavras.length - 1;
  t.textContent = palavras.slice(0, corte).join(' ');
  while (corte > 1 && t.getComputedTextLength() > limite) {
    corte--;
    t.textContent = palavras.slice(0, corte).join(' ');
  }
  const linha1 = t.textContent;
  let linha2 = palavras.slice(corte).join(' ');
  t.textContent = '';
  el('tspan', { x, y: meio - 2 }, t).textContent = linha1;
  const segunda = el('tspan', { x, y: meio + 12 }, t);
  segunda.textContent = linha2;
  while (segunda.getComputedTextLength() > limite && linha2.length > 4) {
    linha2 = linha2.slice(0, -2);
    segunda.textContent = `${linha2}…`;
  }
  el('title', {}, t).textContent = conteudo;
}

// ---------- Barras horizontais ----------
// itens: [{ rotulo, valor, dica }]

export function graficoBarras(container, op) {
  container.classList.add('grafico');
  container.setAttribute('role', 'figure');
  if (op.titulo) container.setAttribute('aria-label', op.titulo);

  redesenharAoRedimensionar(container, (largura) => {
    container.replaceChildren();
    const itens = op.itens;
    const passo = 36;
    const espessura = 16;
    const altura = itens.length * passo + 8;
    const colRotulo = Math.min(230, Math.max(120, largura * 0.34));
    const colValor = 86;
    const max = Math.max(...itens.map((i) => i.valor), 0) || 1;
    const svg = el('svg', { viewBox: `0 0 ${largura} ${altura}`, height: altura }, container);
    const titulo = el('title', {}, svg);
    titulo.textContent = op.titulo || '';
    const larguraUtil = largura - colRotulo - colValor;
    el('line', { class: 'base', x1: colRotulo, x2: colRotulo, y1: 0, y2: altura - 4 }, svg);

    itens.forEach((item, i) => {
      const y = i * passo + 6;
      const w = Math.max(2, (item.valor / max) * larguraUtil);
      const meio = y + passo / 2 - 3;
      const r = Math.min(4, w / 2);
      const topo = meio - espessura / 2;
      const d = `M${colRotulo},${topo}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${espessura - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${w - r}z`;
      rotuloQuebrado(svg, item.rotulo, colRotulo - 10, meio, colRotulo - 14);
      const barra = el('path', { class: 'barra', d, fill: item.cor || op.cor || 'var(--serie-1)', tabindex: 0 }, svg);
      texto(svg, op.formato(item.valor), { class: 'rotulo-barra', x: colRotulo + w + 8, y: meio + 4.5 });
      const exibir = (e) => {
        const caixa = barra.getBoundingClientRect();
        mostrarDica(e?.clientX ?? caixa.right, e?.clientY ?? caixa.top, item.rotulo, [{ cor: item.cor || op.cor || 'var(--serie-1)', valor: op.formato(item.valor), nome: item.dica }]);
      };
      barra.addEventListener('pointermove', exibir);
      barra.addEventListener('focus', () => exibir());
      barra.addEventListener('pointerleave', esconderDica);
      barra.addEventListener('blur', esconderDica);
      if (op.aoClicar) {
        barra.style.cursor = 'pointer';
        barra.addEventListener('click', () => op.aoClicar(item));
        barra.addEventListener('keydown', (e) => e.key === 'Enter' && op.aoClicar(item));
      }
    });
  });
}

// ---------- Colunas (uma por ano) ----------
// itens: [{ rotulo, valor, parcial, dica }]

export function graficoColunas(container, op) {
  const altura = op.altura ?? 220;
  container.classList.add('grafico');
  container.setAttribute('role', 'figure');
  if (op.titulo) container.setAttribute('aria-label', op.titulo);

  redesenharAoRedimensionar(container, (largura) => {
    container.replaceChildren();
    const itens = op.itens;
    const m = { topo: 22, base: op.faixas ? 40 : 26, esq: 4, dir: 4 };
    const max = Math.max(...itens.map((i) => i.valor), 0) || 1;
    const svg = el('svg', { viewBox: `0 0 ${largura} ${altura}`, height: altura }, container);
    const titulo = el('title', {}, svg);
    titulo.textContent = op.titulo || '';
    const banda = (largura - m.esq - m.dir) / itens.length;
    const espessura = Math.min(24, banda * 0.56);
    const baseY = altura - m.base;
    el('line', { class: 'base', x1: m.esq, x2: largura - m.dir, y1: baseY, y2: baseY }, svg);
    const pequeno = banda < 46;

    itens.forEach((item, i) => {
      const cx = m.esq + banda * i + banda / 2;
      const h = Math.max(2, (item.valor / max) * (baseY - m.topo));
      const r = Math.min(4, espessura / 2);
      const x = cx - espessura / 2;
      const y = baseY - h;
      const d = `M${x},${baseY}v-${h - r}a${r},${r} 0 0 1 ${r},-${r}h${espessura - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}z`;
      const cor = item.cor || op.cor || 'var(--serie-1)';
      const barra = el('path', { class: 'barra', d, fill: cor, 'fill-opacity': item.parcial ? 0.45 : 1, tabindex: 0 }, svg);
      if (!pequeno || i === itens.length - 1 || item.destaque) {
        texto(svg, op.formatoCurto ? op.formatoCurto(item.valor) : op.formato(item.valor), { class: 'rotulo-barra', x: cx, y: y - 7, 'text-anchor': 'middle', 'font-size': pequeno ? 10.5 : null });
      }
      texto(svg, pequeno ? `’${item.rotulo.slice(-2)}` : item.rotulo, { class: 'rotulo-eixo', x: cx, y: baseY + 16, 'text-anchor': 'middle' });
      const exibir = (e) => {
        const caixa = barra.getBoundingClientRect();
        mostrarDica(e?.clientX ?? caixa.right, e?.clientY ?? caixa.top, item.rotuloLongo || item.rotulo, [{ cor, valor: op.formato(item.valor), nome: item.dica }]);
      };
      barra.addEventListener('pointermove', exibir);
      barra.addEventListener('focus', () => exibir());
      barra.addEventListener('pointerleave', esconderDica);
      barra.addEventListener('blur', esconderDica);
    });

    if (op.faixas) {
      for (const f of op.faixas) {
        const ini = itens.findIndex((i) => i.grupo === f.id);
        if (ini < 0) continue;
        const qtd = itens.filter((i) => i.grupo === f.id).length;
        const x1 = m.esq + banda * ini + 4;
        const x2 = m.esq + banda * (ini + qtd) - 4;
        el('line', { x1, x2, y1: altura - 14, y2: altura - 14, stroke: 'var(--linha-forte)' }, svg);
        texto(svg, f.rotulo, { class: 'rotulo-mandato', x: (x1 + x2) / 2, y: altura - 2, 'text-anchor': 'middle' });
      }
    }
  });
}

// ---------- Faísca (sparkline) ----------

export function faisca(svg, pontos, { largura = 92, altura = 30 } = {}) {
  const w = largura;
  const h = altura;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.replaceChildren();
  if (pontos.length < 2) return;
  const ys = pontos.map((p) => p[1]);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const px = (i) => 3 + (i / (pontos.length - 1)) * (w - 8);
  const py = (v) => 4 + (1 - (v - min) / (max - min || 1)) * (h - 8);
  const d = pontos.map((p, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(p[1]).toFixed(1)}`).join('');
  el('path', { d, fill: 'none', stroke: 'var(--tinta-3)', 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
  el('circle', { cx: px(pontos.length - 1), cy: py(ys[ys.length - 1]), r: 3, fill: 'var(--serie-1)' }, svg);
}

// ---------- Tabela equivalente ----------

export function tabela(cabecalhos, linhas, legenda) {
  const wrap = document.createElement('div');
  wrap.className = 'tabela-wrap';
  const t = document.createElement('table');
  t.className = 'tabela';
  if (legenda) {
    const c = document.createElement('caption');
    c.className = 'oculto';
    c.textContent = legenda;
    t.appendChild(c);
  }
  const thead = t.createTHead().insertRow();
  for (const h of cabecalhos) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = h;
    thead.appendChild(th);
  }
  const tbody = t.createTBody();
  for (const linha of linhas) {
    const tr = tbody.insertRow();
    linha.forEach((celula, i) => {
      const c = document.createElement(i === 0 ? 'th' : 'td');
      if (i === 0) c.scope = 'row';
      c.textContent = celula;
      tr.appendChild(c);
    });
  }
  wrap.appendChild(t);
  return wrap;
}

export function botaoTabela(pai, gerar) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'link-tabela';
  b.textContent = 'Ver os números em tabela';
  b.setAttribute('aria-expanded', 'false');
  let aberta = null;
  b.addEventListener('click', () => {
    if (aberta) {
      aberta.remove();
      aberta = null;
      b.textContent = 'Ver os números em tabela';
      b.setAttribute('aria-expanded', 'false');
    } else {
      aberta = gerar();
      pai.after(aberta);
      b.textContent = 'Esconder tabela';
      b.setAttribute('aria-expanded', 'true');
    }
  });
  return b;
}
