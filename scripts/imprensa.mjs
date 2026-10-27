// Imprensa lado a lado: a mesma notícia contada por veículos diferentes.
// Lê os feeds públicos (RSS) de cada veículo, agrupa as matérias sobre o mesmo fato e guarda, de cada uma,
// só o título, um trecho curto e o link. O site não classifica nenhum veículo nem julga o conteúdo:
// mostra o que cada um escreveu, marca o que o próprio veículo publica como opinião ou análise
// e confere números de indicadores citados nos títulos.

import { buscar, esperar } from './lib/http.mjs';
import { montarFiltro, conferirNumero } from './lib/verificacao.mjs';

const TAMANHO_TRECHO = 220;

// ---------- Leitura de RSS ----------

const ENTIDADES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', ordm: 'º', ordf: 'ª', deg: '°',
  aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã', eacute: 'é', ecirc: 'ê', iacute: 'í', oacute: 'ó', ocirc: 'ô', otilde: 'õ',
  uacute: 'ú', uuml: 'ü', ccedil: 'ç', ntilde: 'ñ', Aacute: 'Á', Agrave: 'À', Acirc: 'Â', Atilde: 'Ã', Eacute: 'É', Ecirc: 'Ê',
  Iacute: 'Í', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Uacute: 'Ú', Ccedil: 'Ç', Ntilde: 'Ñ',
};

export function decodificarEntidades(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTIDADES[e] ?? m;
  });
}

const semCdata = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const semTags = (s) => s.replace(/<[^>]+>/g, ' ');
// Ao tirar as tags sobram espaços antes da pontuação ("Senado , Davi"); eles saem junto.
const limpar = (s) =>
  decodificarEntidades(semTags(decodificarEntidades(semCdata(s || ''))))
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .trim();

// Chamadas que os feeds acrescentam ao fim do resumo ("Leia na Gazeta do Povo", "O post … apareceu primeiro em …").
const RODAPE_FEED = /\s*(Leia (mais|na|no|em)\b[^.]*\.?|Continue (lendo|a ler)\b[^.]*\.?|O post .+ apareceu primeiro em .+|The post .+ appeared first on .+)\s*$/i;

function campo(xml, nome) {
  const m = xml.match(new RegExp(`<${nome}\\b[^>]*>([\\s\\S]*?)</${nome}>`, 'i'));
  return m ? m[1] : '';
}

function campos(xml, nome) {
  return [...xml.matchAll(new RegExp(`<${nome}\\b[^>]*>([\\s\\S]*?)</${nome}>`, 'gi'))].map((m) => limpar(m[1]));
}

// Folha e UOL ainda usam Latin-1: a Folha declara isso no próprio arquivo; o UOL, só no cabeçalho HTTP.
// Por isso, um arquivo que não é UTF-8 válido também é lido como Latin-1.
export function decodificarFeed(bytes) {
  const cabeca = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const cod = cabeca.match(/encoding=["']([\w-]+)["']/i)?.[1]?.toLowerCase() || 'utf-8';
  if (/8859-1|latin|1252/.test(cod)) return new TextDecoder('latin1').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

// A Folha passa os links por um redirecionador: o endereço real vem depois do asterisco.
const linkReal = (link) => (link.includes('/redir/') && link.includes('*') ? link.slice(link.indexOf('*') + 1) : link);

// Datas de RSS em inglês ("Tue, 27 Oct 2026") ou, como no UOL, em português ("Ter, 27 Out 2026").
const MESES_PT = { jan: 'Jan', fev: 'Feb', mar: 'Mar', abr: 'Apr', mai: 'May', jun: 'Jun', jul: 'Jul', ago: 'Aug', set: 'Sep', out: 'Oct', nov: 'Nov', dez: 'Dec' };

export function lerData(texto) {
  if (!texto) return null;
  let t = Date.parse(texto);
  if (!Number.isFinite(t)) {
    const ingles = texto
      .replace(/^[^\d,]+,\s*/, '')
      .replace(/\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\w*/i, (m, a) => MESES_PT[a.toLowerCase()]);
    t = Date.parse(ingles);
  }
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function lerRss(xml) {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(([, it]) => {
    const resumo = limpar(campo(it, 'description')) || limpar(campo(it, 'atom:subtitle')) || limpar(campo(it, 'content:encoded'));
    const data = limpar(campo(it, 'pubDate')) || limpar(campo(it, 'dc:date'));
    return {
      titulo: limpar(campo(it, 'title')),
      link: linkReal(limpar(campo(it, 'link')) || limpar(campo(it, 'guid'))),
      resumo: resumo.replace(/\s*Leia mais\s*\(.*?\)\s*$/i, '').replace(RODAPE_FEED, ''),
      categorias: campos(it, 'category'),
      publicadoEm: lerData(data),
    };
  });
}

export function trecho(texto, limite = TAMANHO_TRECHO) {
  if (!texto || texto.length <= limite) return texto || '';
  const corte = texto.slice(0, limite);
  return `${corte.slice(0, Math.max(corte.lastIndexOf(' '), limite - 30)).replace(/[,;:.\s]+$/, '')}…`;
}

// ---------- Notícia, análise ou coluna ----------

// Só vale a marcação feita pelo próprio veículo: seção do endereço, categoria do feed ou prefixo do título.
// "coluna" reúne colunas, blogs, artigos, editoriais e seções de opinião; "analise", textos que o veículo chama de análise.
export function tipoDeTexto(item, regras) {
  const url = item.link.toLowerCase();
  const categorias = item.categorias.join(' | ');
  const em = (re) => new RegExp(re, 'iu');
  const casa = (r) => em(r.url).test(url) || em(r.categorias).test(categorias) || em(r.titulo).test(item.titulo);
  if (casa(regras.analise)) return 'analise';
  if (casa(regras.coluna)) return 'coluna';
  return 'noticia';
}

// ---------- O mesmo fato em veículos diferentes ----------

const PARADAS = new Set(
  ('a o as os um uma uns umas de do da dos das no na nos nas em por para pelo pela pelos pelas com sem sob sobre ' +
    'e ou mas que se ao aos à às é ser foi são está estão tem têm ter vai diz dizem após antes até entre contra ' +
    'como mais menos muito já não sim seu sua seus suas ele ela eles elas isso esse essa este esta onde quando ' +
    'veja leia saiba entenda vídeo video ao vivo hoje ontem amanhã nesta neste nessa nesse deste desta ' +
    'el la los las del al y en con por para una unos unas su sus lo es se que como más tras ante según sobre').split(' '),
);

const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Radical simples: as cinco primeiras letras. Junta flexões ("eleição", "eleições") e aproxima
// português e espanhol ("inflação", "inflación"), o que basta para comparar títulos.
export function palavras(texto) {
  return (texto.match(/[\p{L}\p{N}][\p{L}\p{N},.%-]*/gu) || [])
    .map((original) => ({ original: original.replace(/[,.]+$/, ''), base: semAcento(original.toLowerCase()).replace(/[,.]+$/, '') }))
    .filter(({ base }) => base.length > 1 && !PARADAS.has(base))
    .map((p) => ({ ...p, radical: /^\d/.test(p.base) ? p.base : p.base.slice(0, 5) }));
}

function vetor(item, idf) {
  const v = new Map();
  for (const { radical } of palavras(item.titulo)) v.set(radical, (v.get(radical) || 0) + 2);
  for (const { radical } of palavras(trecho(item.resumo, 300))) v.set(radical, (v.get(radical) || 0) + 1);
  let norma = 0;
  for (const [k, tf] of v) {
    const peso = tf * (idf.get(k) || 0);
    v.set(k, peso);
    norma += peso * peso;
  }
  norma = Math.sqrt(norma) || 1;
  for (const [k, p] of v) v.set(k, p / norma);
  return v;
}

function cosseno(a, b) {
  let s = 0;
  const [menor, maior] = a.size < b.size ? [a, b] : [b, a];
  for (const [k, p] of menor) s += p * (maior.get(k) || 0);
  return s;
}

// Agrupamento por ligação média: junta primeiro os pares mais parecidos e só aceita a junção se a
// semelhança média entre os grupos continuar acima do limiar. Cada grupo tem no máximo uma matéria por veículo.
export function agruparMesmoFato(itens, { limiar = 0.3 } = {}) {
  const df = new Map();
  for (const it of itens) for (const r of new Set(palavras(`${it.titulo} ${trecho(it.resumo, 300)}`).map((p) => p.radical))) df.set(r, (df.get(r) || 0) + 1);
  const idf = new Map([...df].map(([r, n]) => [r, Math.log((itens.length + 1) / n)]));
  const vetores = itens.map((it) => vetor(it, idf));

  const pares = [];
  for (let i = 0; i < itens.length; i++) {
    for (let j = i + 1; j < itens.length; j++) {
      if (itens[i].veiculo === itens[j].veiculo) continue;
      const s = cosseno(vetores[i], vetores[j]);
      if (s >= limiar) pares.push([s, i, j]);
    }
  }
  pares.sort((a, b) => b[0] - a[0]);
  const sim = new Map(pares.map(([s, i, j]) => [`${i}-${j}`, s]));
  const semelhanca = (i, j) => (i === j ? 1 : sim.get(i < j ? `${i}-${j}` : `${j}-${i}`) || 0);

  const grupoDe = itens.map((_, i) => i);
  const membros = new Map(itens.map((_, i) => [i, [i]]));
  for (const [, i, j] of pares) {
    const gi = grupoDe[i];
    const gj = grupoDe[j];
    if (gi === gj) continue;
    const a = membros.get(gi);
    const b = membros.get(gj);
    const veiculos = new Set(a.map((k) => itens[k].veiculo));
    if (b.some((k) => veiculos.has(itens[k].veiculo))) continue;
    let soma = 0;
    for (const x of a) for (const y of b) soma += semelhanca(x, y);
    if (soma / (a.length * b.length) < limiar) continue;
    for (const k of b) grupoDe[k] = gi;
    membros.set(gi, [...a, ...b]);
    membros.delete(gj);
  }
  return [...membros.values()].map((ids) => ids.map((k) => itens[k]));
}

// Palavras dos títulos: as que aparecem em quase todos (o fato em comum) e as que só um veículo usou.
export function compararTitulos(grupo) {
  const porItem = grupo.map((it) => palavras(it.titulo));
  const contagem = new Map();
  const forma = new Map();
  porItem.forEach((ps) => {
    for (const r of new Set(ps.map((p) => p.radical))) contagem.set(r, (contagem.get(r) || 0) + 1);
    for (const p of ps) if (!forma.has(p.radical)) forma.set(p.radical, p.original);
  });
  const minimo = Math.max(2, Math.ceil(grupo.length * 0.6));
  const comuns = [...contagem].filter(([, n]) => n >= minimo).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([r]) => forma.get(r));
  const marcados = grupo.map((it) => {
    const exclusivos = new Set(palavras(it.titulo).filter((p) => contagem.get(p.radical) === 1).map((p) => p.original));
    // Divide o título em trechos, marcando as palavras que nenhum outro veículo usou.
    const partes = [];
    for (const pedaco of it.titulo.split(/(\s+)/)) {
      const limpo = pedaco.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, '');
      const exclusivo = limpo && exclusivos.has(limpo);
      const ultimo = partes.at(-1);
      if (ultimo && ultimo[1] === exclusivo) ultimo[0] += pedaco;
      else partes.push([pedaco, exclusivo]);
    }
    return partes;
  });
  return { comuns, marcados };
}

// ---------- Coleta ----------

async function lerVeiculo(v, avisar) {
  const itens = [];
  let falhas = 0;
  for (const url of v.feeds) {
    try {
      const xml = decodificarFeed(await buscar(url, { tipo: 'bytes', tentativas: 2, tempoLimite: 30000 }));
      itens.push(...lerRss(xml));
    } catch (e) {
      falhas++;
      avisar('imprensa', `${v.nome}: feed ${url} não respondeu (${e.message}).`);
    }
    await esperar(300);
  }
  const filtro = v.somenteSe ? new RegExp(v.somenteSe, 'iu') : null;
  const vistos = new Set();
  return {
    falhou: falhas === v.feeds.length,
    itens: itens.filter((it) => {
      if (!it.titulo || !it.link || !it.publicadoEm || vistos.has(it.link)) return false;
      vistos.add(it.link);
      return !filtro || filtro.test(`${it.titulo} ${it.resumo} ${it.categorias.join(' ')}`);
    }),
  };
}

export async function coletarMaterias(config, avisar, agoraIso) {
  const agora = Date.parse(agoraIso);
  const desde = agora - config.janelaHoras * 3600e3;
  const todos = [];
  const situacao = [];
  const vistos = new Set();
  for (const v of config.veiculos) {
    const r = await lerVeiculo(v, avisar);
    const recentes = r.itens.filter((it) => {
      const t = Date.parse(it.publicadoEm);
      return t >= desde && t <= agora + 3600e3;
    });
    situacao.push({ id: v.id, nome: v.nome, idioma: v.idioma || 'pt', ok: !r.falhou, materias: recentes.length });
    for (const it of recentes) {
      // O UOL republica matérias da Folha com o mesmo endereço: a matéria conta uma vez só, para quem a publicou antes na lista.
      if (vistos.has(it.link)) continue;
      vistos.add(it.link);
      todos.push({ ...it, veiculo: v.id, tipo: tipoDeTexto(it, config.marcacao) });
    }
  }
  return { todos, situacao };
}

export async function coletarImprensa(ctx, anterior, avisar, config, filtroPolitico, series) {
  const { todos, situacao } = await coletarMaterias(config, avisar, ctx.agora);
  const respondeu = situacao.filter((s) => s.ok).length;
  if (respondeu < config.minimoVeiculos) {
    avisar('imprensa', `Só ${respondeu} veículos responderam; mantida a comparação anterior.`);
    return anterior;
  }

  // O filtro político não retira nada aqui: marca os fatos de política partidária, e o leitor escolhe se quer vê-los.
  const politico = montarFiltro(filtroPolitico);
  const grupos = agruparMesmoFato(todos, { limiar: config.limiar })
    .filter((g) => g.length >= config.minimoVeiculos)
    .map((g) => {
      const ordenado = [...g].sort((a, b) => (a.publicadoEm < b.publicadoEm ? -1 : 1));
      const { comuns, marcados } = compararTitulos(ordenado);
      // O fato é de política partidária quando o termo está no título de pelo menos metade dos veículos;
      // uma menção de passagem no resumo ("governo Lula") não muda o assunto da notícia.
      const termos = ordenado.map((it) => politico(it.titulo)).filter(Boolean);
      const termo = termos.length * 2 >= ordenado.length ? termos[0] : null;
      return {
        id: ordenado[0].link,
        veiculos: ordenado.length,
        primeiro: ordenado[0].publicadoEm,
        ultimo: ordenado.at(-1).publicadoEm,
        comuns,
        politica: termo || null,
        materias: ordenado.map((it, k) => ({
          veiculo: it.veiculo,
          titulo: it.titulo,
          tituloMarcado: marcados[k],
          trecho: trecho(it.resumo),
          link: it.link,
          publicadoEm: it.publicadoEm,
          tipo: it.tipo,
          numero: series ? conferirNumero({ titulo: it.titulo, resumo: it.resumo, publicadoEm: it.publicadoEm }, series) : null,
        })),
      };
    })
    .sort((a, b) => b.veiculos - a.veiculos || (a.ultimo < b.ultimo ? 1 : -1));

  const comparacoes = grupos.slice(0, config.maximoComparacoes);
  const politicos = comparacoes.filter((g) => g.politica).length;
  console.log(`✓ imprensa: ${todos.length} matérias de ${respondeu} veículos, ${grupos.length} fatos em ${config.minimoVeiculos}+ veículos, ${comparacoes.length} publicados (${politicos} de política partidária)`);
  return {
    geradoEm: ctx.agora,
    janelaHoras: config.janelaHoras,
    nota: config.nota,
    veiculos: situacao,
    totalMaterias: todos.length,
    comparacoes,
  };
}
