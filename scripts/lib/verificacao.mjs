// Regras de verificação: cruzamento entre fontes, testes de plausibilidade,
// filtro de conteúdo político-partidário e conferência de números citados em notícias.

import { MESES, rotuloPeriodo } from '../../assets/js/nucleo.js';

// ---------- Cruzamento entre duas séries ----------

export function cruzar(primaria, secundaria, tolerancia) {
  const mapa = new Map(secundaria);
  const comuns = primaria.filter(([p]) => mapa.has(p)).slice(-12);
  if (!comuns.length) return { status: 'sem-conferencia', motivo: 'Nenhum período em comum entre as fontes.' };
  let conferidos = 0;
  let maiorDiferenca = 0;
  for (const [p, v] of comuns) {
    const d = Math.abs(v - mapa.get(p));
    maiorDiferenca = Math.max(maiorDiferenca, d);
    if (d <= tolerancia) conferidos++;
  }
  const [periodo, valorPrimaria] = comuns[comuns.length - 1];
  const valorConferencia = mapa.get(periodo);
  const ultimoPrimaria = primaria[primaria.length - 1][0];
  return {
    status: Math.abs(valorPrimaria - valorConferencia) <= tolerancia ? 'confere' : 'diverge',
    periodo,
    valorPrimaria,
    valorConferencia,
    diferenca: Number((valorPrimaria - valorConferencia).toFixed(6)),
    comparados: comuns.length,
    conferidos,
    maiorDiferenca: Number(maiorDiferenca.toFixed(6)),
    defasagem: periodo !== ultimoPrimaria ? `A segunda fonte ainda não publicou ${ultimoPrimaria}; o último período comum é ${periodo}.` : null,
  };
}

export function toleranciaPadrao(casas) {
  return 0.5 * 10 ** -casas + 1e-9;
}

// ---------- Plausibilidade ----------

export function testarPlausibilidade(pontos, [minimo, maximo], hoje) {
  if (!pontos.length) return 'A fonte não devolveu nenhum ponto.';
  for (let i = 0; i < pontos.length; i++) {
    const [p, v] = pontos[i];
    if (!Number.isFinite(v)) return `Valor não numérico em ${p}.`;
    if (v < minimo || v > maximo) return `Valor ${v} em ${p} está fora da faixa plausível (${minimo} a ${maximo}).`;
    if (i && pontos[i - 1][0] >= p) return `Períodos fora de ordem ou repetidos perto de ${p}.`;
  }
  const ultimo = pontos[pontos.length - 1][0];
  if (ultimo.slice(0, 7) > hoje.slice(0, 7)) return `Último período (${ultimo}) está no futuro.`;
  return null;
}

// ---------- Filtro político-partidário ----------

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function montarFiltro({ termos, siglas }) {
  const limite = '(?<![\\p{L}\\p{N}])';
  const fim = '(?![\\p{L}\\p{N}])';
  const regras = [
    ...termos.map((t) => ({ termo: t, re: new RegExp(`${limite}${escapar(t)}${fim}`, 'iu') })),
    ...siglas.map((t) => ({ termo: t, re: new RegExp(`${limite}${escapar(t)}${fim}`, 'u') })),
  ];
  return (texto) => {
    for (const { termo, re } of regras) if (re.test(texto)) return termo;
    return null;
  };
}

// ---------- Notícias: normalização e triagem, usadas pela coleta e pelo navegador ----------

// Converte a resposta da API de notícias do IBGE para o formato do site.
export function normalizarNoticiasIbge(resposta) {
  return resposta.items.map((n) => {
    const [d, m, resto] = n.data_publicacao.split('/');
    const [a, hora] = resto.split(' ');
    return {
      fonte: 'IBGE',
      fonteNome: 'Agência de Notícias do IBGE',
      id: `ibge-${n.id}`,
      tipo: n.tipo === 'Release' ? 'Divulgação de dado oficial' : 'Notícia institucional',
      titulo: n.titulo,
      resumo: n.introducao,
      publicadoEm: `${a}-${m}-${d}T${hora}-03:00`,
      link: n.link.replace(/^http:/, 'https:'),
      editorias: n.editorias,
    };
  });
}

// "Dados" = divulgação de estatística ou indicador; "institucional" = agenda, eventos, cooperação, regulação.
export function categoriaNoticia(n) {
  if (n.fonte === 'IBGE') return n.tipo === 'Divulgação de dado oficial' || /economicas|sociais/.test(n.editorias || '') ? 'dados' : 'institucional';
  return /\bdivulga\b|IBC-Br|Copom|Selic|Focus|estatísticas|relatório/i.test(n.titulo) ? 'dados' : 'institucional';
}

// Aplica o filtro político e a conferência de números; devolve as publicadas e as retiradas.
export function triarNoticias(brutas, series, filtroConfig) {
  const politico = montarFiltro(filtroConfig);
  const itens = [];
  const excluidos = [];
  const vistos = new Set();
  for (const n of brutas) {
    if (vistos.has(n.id)) continue;
    vistos.add(n.id);
    const termo = politico(`${n.titulo} ${n.resumo || ''}`);
    if (termo) {
      excluidos.push({ id: n.id, fonte: n.fonte, titulo: n.titulo, link: n.link, publicadoEm: n.publicadoEm, termo });
      continue;
    }
    itens.push({
      ...n,
      categoria: categoriaNoticia(n),
      verificacoes: { fonteOficial: true, semConteudoPolitico: true, numero: conferirNumero(n, series) },
    });
  }
  const porData = (a, b) => (a.publicadoEm < b.publicadoEm ? 1 : -1);
  return { itens: itens.sort(porData), excluidos: excluidos.sort(porData) };
}

// ---------- Números citados em notícias ----------

const NOME_MES = new RegExp(`\\b(${MESES.join('|')})\\b`, 'i');
const TRIMESTRE = /\b(primeiro|segundo|terceiro|quarto|1º|2º|3º|4º)\s+trimestre\b/i;
const ORDEM_TRIMESTRE = { primeiro: 1, segundo: 2, terceiro: 3, quarto: 4, '1º': 1, '2º': 2, '3º': 3, '4º': 4 };

function porcentagens(texto) {
  return [...texto.matchAll(/(-?\d{1,3}(?:,\d{1,2})?)\s?%/g)].map((m) => Number(m[1].replace(',', '.')));
}

function anoReferencia(texto, mes, publicadoEm) {
  const explicito = texto.match(/\b(20\d{2})\b/);
  if (explicito) return Number(explicito[1]);
  const anoPub = Number(publicadoEm.slice(0, 4));
  const mesPub = Number(publicadoEm.slice(5, 7));
  return mes > mesPub ? anoPub - 1 : anoPub;
}

const valorEm = (serie, periodo) => serie?.pontos.find(([p]) => p === periodo)?.[1];

// Devolve null quando a notícia não cita número de indicador acompanhado pelo site.
export function conferirNumero(noticia, series) {
  const titulo = noticia.titulo;
  const texto = `${titulo} ${noticia.resumo || ''}`;
  const numerosTitulo = porcentagens(titulo);
  const numeros = numerosTitulo.length ? numerosTitulo : porcentagens(noticia.resumo || '');
  if (!numeros.length) return null;
  if (/IPCA-15|INPC|IGP|IPP|IPCA-E/i.test(texto)) return null;

  let candidatos = [];
  let descricao = '';
  const mesTexto = texto.match(NOME_MES);

  if (/\bIPCA\b|infla[çc][ãa]o oficial/i.test(texto) && mesTexto) {
    const mes = MESES.indexOf(mesTexto[1].toLowerCase()) + 1;
    const periodo = `${anoReferencia(texto, mes, noticia.publicadoEm)}-${String(mes).padStart(2, '0')}`;
    candidatos = [
      ['ipcaMes', periodo, valorEm(series.ipcaMes, periodo), 2],
      ['ipca12m', periodo, valorEm(series.ipca12m, periodo), 2],
    ];
    descricao = `IPCA de ${rotuloPeriodo(periodo, 'mensal')}`;
  } else if (/desocupa[çc][ãa]o|desemprego/i.test(texto)) {
    let periodo;
    if (mesTexto) {
      const mes = MESES.indexOf(mesTexto[1].toLowerCase()) + 1;
      periodo = `${anoReferencia(texto, mes, noticia.publicadoEm)}-${String(mes).padStart(2, '0')}`;
    } else {
      periodo = series.desemprego?.pontos.filter(([p]) => p <= noticia.publicadoEm.slice(0, 7)).at(-1)?.[0];
    }
    candidatos = [['desemprego', periodo, valorEm(series.desemprego, periodo), 1]];
    descricao = `taxa de desocupação de ${periodo ? rotuloPeriodo(periodo, 'trimestre-movel') : 'período não identificado'}`;
  } else if (/\bPIB\b/.test(texto) && TRIMESTRE.test(texto)) {
    const tri = ORDEM_TRIMESTRE[texto.match(TRIMESTRE)[1].toLowerCase()];
    const ano = anoReferencia(texto, tri * 3, noticia.publicadoEm);
    const periodo = `${ano}-${String(tri * 3).padStart(2, '0')}`;
    candidatos = [
      ['pibTri', periodo, valorEm(series.pibTri, periodo), 1],
      ['pib4tri', periodo, valorEm(series.pib4tri, periodo), 1],
    ];
    descricao = `PIB do ${tri}º trimestre de ${ano}`;
  } else if (/\bSelic\b|\bCopom\b/i.test(texto)) {
    const diaPub = noticia.publicadoEm.slice(0, 10);
    const janela = new Set(
      (series.selic?.ultimosDiarios || [])
        .filter(([d]) => Math.abs(Date.parse(d) - Date.parse(diaPub)) <= 10 * 864e5)
        .map(([, v]) => v),
    );
    candidatos = [...janela].map((v) => ['selic', diaPub, v, 2]);
    descricao = 'meta Selic vigente na semana da nota';
  } else {
    return null;
  }

  candidatos = candidatos.filter(([, , v]) => v != null);
  if (!candidatos.length) {
    return { ok: null, descricao, nota: `O dado oficial correspondente (${descricao}) ainda não está na base do site.` };
  }
  for (const n of numeros) {
    for (const [serie, periodo, v, casas] of candidatos) {
      if (Math.abs(Number(v.toFixed(casas)) - n) < 1e-9) {
        return { ok: true, descricao, serie, periodo, valorNoticia: n, valorSerie: v, nota: `${String(n).replace('.', ',')}% confere com a série oficial (${descricao}).` };
      }
    }
  }
  return {
    ok: false,
    descricao,
    valorNoticia: numeros[0],
    candidatos: candidatos.map(([serie, periodo, v]) => ({ serie, periodo, valor: v })),
    nota: `O número citado não foi encontrado na série oficial (${descricao}). Pode se referir a outro recorte; recomendamos ler a fonte.`,
  };
}
