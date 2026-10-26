// Funções puras compartilhadas entre o site (navegador) e o pipeline de dados (Node).
// Nada aqui toca o DOM ou a rede, para que a mesma lógica possa ser testada e auditada.

export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

export const STATUS = {
  confere: { rotulo: 'Confere com segunda fonte', curto: 'Confere', explicacao: 'O mesmo número foi encontrado em outra fonte oficial independente, ou recalculado a partir dos componentes publicados.' },
  'fonte-unica': { rotulo: 'Fonte única oficial', curto: 'Fonte única', explicacao: 'Publicado apenas pelo órgão que produz o dado. Não há segunda fonte para cruzar, mas o link para o original está disponível.' },
  'sem-conferencia': { rotulo: 'Segunda fonte indisponível hoje', curto: 'Sem conferência hoje', explicacao: 'A segunda fonte não respondeu na coleta de hoje. O número vem da fonte principal; a conferência será refeita na próxima atualização.' },
  diverge: { rotulo: 'Divergência entre fontes', curto: 'Diverge', explicacao: 'As duas fontes publicam números diferentes para o mesmo período. Mostramos o valor da fonte principal e a diferença encontrada.' },
  estimativa: { rotulo: 'Estimativa calculada', curto: 'Estimativa', explicacao: 'Número calculado por este site a partir de dados oficiais. A fórmula está descrita ao lado do valor.' },
  falha: { rotulo: 'Falha na coleta de hoje', curto: 'Coleta falhou', explicacao: 'A fonte não respondeu ou devolveu um valor fora da faixa plausível. Mostramos o último dado válido e a data em que foi obtido.' },
};

// ---------- Períodos ----------
// Mensal e trimestral: 'AAAA-MM' (mês final do período). Anual: 'AAAA'. Diário: 'AAAA-MM-DD'.

export function indiceMes(periodo) {
  const [a, m] = periodo.split('-').map(Number);
  return a * 12 + ((m || 12) - 1);
}

export function periodoDeIndice(i) {
  const a = Math.floor(i / 12);
  const m = (i % 12) + 1;
  return `${a}-${String(m).padStart(2, '0')}`;
}

export function rotuloPeriodo(periodo, periodicidade, { longo = false } = {}) {
  if (!periodo) return '—';
  if (periodicidade === 'anual' || periodo.length === 4) return periodo;
  if (periodo.length === 10) {
    const [a, m, d] = periodo.split('-');
    return longo ? `${Number(d)} de ${MESES[Number(m) - 1]} de ${a}` : `${d}/${m}/${a}`;
  }
  const [a, m] = periodo.split('-').map(Number);
  if (periodicidade === 'trimestral') return `${Math.ceil(m / 3)}º trimestre de ${a}`;
  if (periodicidade === 'trimestre-movel') {
    const [ai, mi] = periodoDeIndice(indiceMes(periodo) - 2).split('-').map(Number);
    return ai === a
      ? `${MESES_CURTOS[mi - 1]}–${MESES_CURTOS[m - 1]}/${a}`
      : `${MESES_CURTOS[mi - 1]}/${ai}–${MESES_CURTOS[m - 1]}/${a}`;
  }
  return longo ? `${MESES[m - 1]} de ${a}` : `${MESES_CURTOS[m - 1]}/${a}`;
}

export function dataPorExtenso(iso) {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dia = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return { semana: DIAS_SEMANA[dia], texto: `${d} de ${MESES[m - 1]} de ${a}` };
}

export function hojeBrasilia(agora = new Date()) {
  return new Date(agora.getTime() - 3 * 3600e3).toISOString().slice(0, 10);
}

// ---------- Números ----------

export function formatarNumero(valor, casas = 1) {
  // Sinal de menos tipográfico (−), mais legível que o hífen em números negativos.
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(valor).replace('-', '−');
}

export function formatarReais(valor, { casas, longo = false } = {}) {
  const abs = Math.abs(valor);
  const escala = [
    [1e12, longo ? (abs >= 2e12 ? 'trilhões' : 'trilhão') : 'tri', 2],
    [1e9, longo ? (abs >= 2e9 ? 'bilhões' : 'bilhão') : 'bi', 1],
    [1e6, longo ? (abs >= 2e6 ? 'milhões' : 'milhão') : 'mi', 1],
  ];
  for (const [base, nome, padrao] of escala) {
    if (abs >= base) return `R$ ${formatarNumero(valor / base, casas ?? padrao)} ${nome}`;
  }
  return `R$ ${formatarNumero(valor, casas ?? 0)}`;
}

export function formatarValor(valor, unidade, casas = 1, { compacto = false } = {}) {
  if (valor == null || Number.isNaN(valor)) return '—';
  switch (unidade) {
    case '%': return `${formatarNumero(valor, casas)}%`;
    case '% a.a.': return compacto ? `${formatarNumero(valor, casas)}%` : `${formatarNumero(valor, casas)}% a.a.`;
    case '% do PIB': return compacto ? `${formatarNumero(valor, casas)}%` : `${formatarNumero(valor, casas)}% do PIB`;
    case 'R$': return `R$ ${formatarNumero(valor, casas)}`;
    case 'R$ mi': return formatarReais(valor * 1e6);
    default: return formatarNumero(valor, casas);
  }
}

// Diferença entre dois valores: pontos percentuais para taxas, variação percentual para níveis em reais.
export function diferenca(de, para, unidade, casas = 1) {
  if (de == null || para == null) return null;
  const emPontos = unidade.startsWith('%');
  const bruto = emPontos ? para - de : ((para - de) / Math.abs(de)) * 100;
  const c = emPontos ? Math.max(casas, 1) : 1;
  const arred = Number(bruto.toFixed(c));
  const sinal = arred > 0 ? '+' : arred < 0 ? '−' : '';
  const texto = `${sinal}${formatarNumero(Math.abs(arred), c)}${emPontos ? ' p.p.' : '%'}`;
  return { valor: bruto, texto, direcao: arred > 0 ? 'sobe' : arred < 0 ? 'desce' : 'igual' };
}

// ---------- Mandatos ----------

export function mandatoEm(dataISO, mandatos) {
  return mandatos.find((m) => dataISO >= m.inicio && dataISO < m.fim) || null;
}

// Posiciona os pontos de uma série mensal/trimestral no calendário de um mandato.
// k = 1 é o mês da posse; a base é o último valor publicado antes dela (o que o mandato recebeu).
export function alinhar(pontos, mandato) {
  const ini = indiceMes(mandato.inicio.slice(0, 7));
  const fim = indiceMes(mandato.fim.slice(0, 7));
  let base = null;
  const serie = [];
  for (const [periodo, valor] of pontos) {
    if (periodo.length === 4) continue;
    const i = indiceMes(periodo);
    if (i < ini) base = { periodo, valor };
    else if (i < fim) serie.push({ k: i - ini + 1, periodo, valor });
  }
  return { base, serie, totalMeses: fim - ini };
}

// Compara o mandato B (o mais recente) com o mandato A no mesmo ponto do calendário:
// se B tem n meses de dados, olhamos o mês n de A. Assim nenhum dos dois é medido por mais tempo.
export function compararMandatos(pontos, mandatoA, mandatoB) {
  const A = alinhar(pontos, mandatoA);
  const B = alinhar(pontos, mandatoB);
  const meses = B.serie.length ? B.serie[B.serie.length - 1].k : 0;
  let mesmoPonto = null;
  if (meses) for (const p of A.serie) if (p.k <= meses) mesmoPonto = p;
  return {
    meses,
    A: { ...A, final: A.serie[A.serie.length - 1] || null, mesmoPonto },
    B: { ...B, atual: B.serie[B.serie.length - 1] || null },
  };
}

// Para contagens mensais (crimes, denúncias): soma dos meses 1 a n do mandato.
// Devolve null se faltar qualquer mês, para nunca comparar um período completo com um incompleto.
export function somaNoMandato(pontos, mandato, n) {
  if (!n) return null;
  const ate = alinhar(pontos, mandato).serie.filter((p) => p.k <= n);
  if (ate.length < n || ate.some((p) => p.valor == null)) return null;
  return ate.reduce((s, p) => s + p.valor, 0);
}

// Soma acumulada mês a mês dentro do mandato: [[k, total até o mês k]].
export function acumuladoNoMandato(pontos, mandato) {
  let soma = 0;
  let anterior = 0;
  const saida = [];
  for (const p of alinhar(pontos, mandato).serie) {
    if (p.k !== anterior + 1) break;
    soma += p.valor;
    anterior = p.k;
    saida.push([p.k, soma]);
  }
  return saida;
}

// Pares [mês, valor] a partir de uma lista de meses e uma lista de valores com lacunas (null).
export function paresMensais(meses, valores) {
  const pares = [];
  meses.forEach((m, i) => {
    if (valores?.[i] != null) pares.push([m, valores[i]]);
  });
  return pares;
}

export function diasAte(dataISO, hojeISO) {
  return Math.round((Date.parse(dataISO) - Date.parse(hojeISO)) / 864e5);
}

// ---------- Orçamento ----------

// Converte um valor acumulado de jan até mesFinal do ano para reais do mês mais recente do IPCA.
export function fatorDeflacao(indice, ano, mesFinal) {
  if (!indice?.length) return null;
  const ultimo = indice[indice.length - 1];
  const doPeriodo = indice.filter(([p]) => p.startsWith(`${ano}-`) && Number(p.slice(5, 7)) <= mesFinal);
  if (!doPeriodo.length) return null;
  const media = doPeriodo.reduce((s, [, v]) => s + v, 0) / doPeriodo.length;
  return { fator: ultimo[1] / media, referencia: ultimo[0] };
}
