// "Em poucas palavras": os principais números traduzidos para linguagem do dia a dia.
// O texto é montado por regras fixas a partir dos dados oficiais, sem adjetivos de avaliação;
// quem quiser conferir encontra cada número, com a fonte, nas seções abaixo.
// Números entre **asteriscos** aparecem em destaque.

import * as N from './nucleo.js';

const num = (v, casas = 1) => N.formatarNumero(v, casas);
const reais = (v, casas) => N.formatarReais(v, { longo: true, casas });
const mesLongo = (p) => N.rotuloPeriodo(p, 'mensal', { longo: true });
const valorEm = (pontos, periodo) => pontos?.find(([p]) => p === periodo)?.[1] ?? null;
const umAnoAntes = (periodo) => N.periodoDeIndice(N.indiceMes(periodo) - 12);

function precos(S, meta) {
  const s = S.ipca12m;
  if (!s) return null;
  const { periodo, valor } = s.ultimo;
  const frases = [
    valor >= 0
      ? `Os preços subiram em média **${num(valor, 2)}%** nos 12 meses até ${mesLongo(periodo)}. O que custava R$ 100 há um ano custa hoje, em média, **R$ ${num(100 + valor, 2)}**.`
      : `Os preços caíram em média **${num(-valor, 2)}%** nos 12 meses até ${mesLongo(periodo)}.`,
  ];
  if (meta) {
    const faixa = `entre ${num(meta.piso)}% e ${num(meta.teto)}% ao ano`;
    frases.push(
      valor > meta.teto
        ? `Está acima do limite da meta oficial de inflação, que vai de ${num(meta.piso)}% a ${num(meta.teto)}% ao ano.`
        : valor < meta.piso
          ? `Está abaixo do limite inferior da meta oficial de inflação, que vai de ${num(meta.piso)}% a ${num(meta.teto)}% ao ano.`
          : `Está dentro da meta oficial de inflação, que aceita valores ${faixa}.`,
    );
  }
  return { id: 'precos', tema: 'Preços', frases, serie: s, fonte: 'IBGE' };
}

function juros(S) {
  const s = S.selic;
  if (!s) return null;
  const atual = s.ultimoDiario?.valor ?? s.ultimo.valor;
  const pts = s.pontos;
  let i = pts.length - 1;
  while (i > 0 && pts[i - 1][1] === atual) i--;
  const mudou = i > 0 ? { mes: pts[i][0], antes: pts[i - 1][1] } : null;
  const frases = [`A Selic, taxa básica de juros, está em **${num(atual, 2)}% ao ano**.`];
  if (mudou) {
    frases.push(
      N.indiceMes(pts[pts.length - 1][0]) - N.indiceMes(mudou.mes) <= 1
        ? `Mudou em ${mesLongo(mudou.mes)}, de ${num(mudou.antes, 2)}% para ${num(atual, 2)}%.`
        : `Está nesse nível desde ${mesLongo(mudou.mes)}, quando passou de ${num(mudou.antes, 2)}% para ${num(atual, 2)}%.`,
    );
  }
  frases.push('Quando ela sobe, empréstimos e financiamentos tendem a ficar mais caros; quando cai, mais baratos.');
  return { id: 'juros', tema: 'Juros', frases, serie: s, fonte: 'Banco Central' };
}

function emprego(S) {
  const s = S.desemprego;
  if (!s) return null;
  const { periodo, valor } = s.ultimo;
  const antes = valorEm(s.pontos, umAnoAntes(periodo));
  const frases = [
    `De cada 100 pessoas que trabalham ou procuram trabalho, cerca de **${Math.round(valor)}** estão sem emprego (taxa de ${num(valor)}% em ${N.rotuloPeriodo(periodo, 'trimestre-movel')}).`,
  ];
  if (antes != null) frases.push(`Um ano antes, a taxa era de ${num(antes)}%.`);
  return { id: 'emprego', tema: 'Emprego', frases, serie: s, fonte: 'IBGE' };
}

function renda(S) {
  const s = S.rendimento;
  if (!s) return null;
  const { periodo, valor } = s.ultimo;
  const antes = valorEm(s.pontos, umAnoAntes(periodo));
  const frases = [`Quem trabalha recebe em média **R$ ${num(valor, 0)} por mês**, já descontada a inflação (${N.rotuloPeriodo(periodo, 'trimestre-movel')}).`];
  if (antes) {
    const v = ((valor - antes) / antes) * 100;
    frases.push(
      Math.abs(v) < 0.05
        ? 'O poder de compra do salário médio ficou igual ao de um ano antes.'
        : `Em um ano, o poder de compra do salário médio ${v > 0 ? 'aumentou' : 'diminuiu'} **${num(Math.abs(v))}%**.`,
    );
  }
  return { id: 'renda', tema: 'Renda', frases, serie: s, fonte: 'IBGE' };
}

function economia(S) {
  const a = S.pib4tri;
  const t = S.pibTri;
  if (!a) return null;
  const tri = N.rotuloPeriodo(a.ultimo.periodo, 'trimestral');
  const frases = [
    a.ultimo.valor >= 0
      ? `A economia do país (o PIB) cresceu **${num(a.ultimo.valor)}%** nos 12 meses até o ${tri}.`
      : `A economia do país (o PIB) encolheu **${num(-a.ultimo.valor)}%** nos 12 meses até o ${tri}.`,
  ];
  if (t) {
    frases.push(
      t.ultimo.valor === 0
        ? 'No último trimestre, ficou estável em relação ao anterior.'
        : `No último trimestre, ${t.ultimo.valor > 0 ? 'cresceu' : 'encolheu'} ${num(Math.abs(t.ultimo.valor))}% em relação ao trimestre anterior.`,
    );
  }
  return { id: 'economia', tema: 'Economia', frases, serie: a, fonte: 'IBGE' };
}

function dolar(S, cambio) {
  const usd = cambio?.moedas?.find((m) => m.codigo === 'USD');
  const s = S.dolar;
  const ultimo = usd?.pontos.at(-1) ?? (s?.ultimoDiario ? [s.ultimoDiario.data, s.ultimoDiario.valor] : null);
  if (!ultimo) return null;
  const [data, valor] = ultimo;
  const frases = [`Um dólar custa **R$ ${num(valor, 2)}** (cotação oficial de ${N.rotuloPeriodo(data, 'diaria')}).`];
  if (usd) {
    const alvo = Date.parse(data) - 365 * 864e5;
    const antes = [...usd.pontos].reverse().find(([d]) => Date.parse(d) <= alvo);
    if (antes) {
      const real = (antes[1] / valor - 1) * 100;
      frases.push(`Há um ano custava R$ ${num(antes[1], 2)}: o real ${real >= 0 ? 'ganhou' : 'perdeu'} **${num(Math.abs(real))}%** frente ao dólar.`);
    }
  }
  frases.push('Real mais forte tende a baratear importados e viagens ao exterior; mais fraco, a encarecê-los.');
  return { id: 'dolar', tema: 'Dólar', frases, serie: s, fonte: 'Banco Central' };
}

function contas(S, aux) {
  const s = S.primario;
  if (!s) return null;
  const { periodo, valor } = s.ultimo;
  const pib = valorEm(aux?.pib12m?.pontos, periodo);
  const bilhoes = pib ? Math.abs(valor / 100) * pib * 1e6 : null;
  const frases = [
    valor < 0
      ? `Nos 12 meses até ${mesLongo(periodo)}, o setor público **gastou mais do que arrecadou**, sem contar os juros da dívida.`
      : `Nos 12 meses até ${mesLongo(periodo)}, o setor público **arrecadou mais do que gastou**, sem contar os juros da dívida.`,
    `${valor < 0 ? 'O déficit' : 'O superávit'} foi de ${num(Math.abs(valor), 2)}% do PIB${bilhoes ? `, cerca de **${reais(bilhoes, 0)}**` : ''}.`,
  ];
  return { id: 'contas', tema: 'Contas do governo', frases, serie: s, fonte: 'Banco Central' };
}

function divida(S) {
  const s = S.dbgg;
  if (!s) return null;
  const { periodo, valor } = s.ultimo;
  const antes = valorEm(s.pontos, umAnoAntes(periodo));
  const frases = [
    `A dívida do governo (União, estados e municípios) equivale a **${num(valor)}%** de tudo o que o país produz em um ano: para cada R$ 100 produzidos, há **R$ ${num(valor, 0)}** de dívida.`,
  ];
  if (antes != null) frases.push(`Um ano antes, eram R$ ${num(antes, 0)} para cada R$ 100.`);
  return { id: 'divida', tema: 'Dívida pública', frases, serie: s, fonte: 'Banco Central' };
}

function impostos(O, aux) {
  if (!O) return null;
  const ref = O.referencia;
  const doAno = (ano) => O.anos.find((a) => a.ano === ano)?.[ref.periodo === 6 ? 'completo' : 'mesmoPeriodo'];
  const d = doAno(ref.ano);
  if (!d) return null;
  const total = d.receitaTributaria + d.contribuicoes;
  const pop = aux?.populacao?.pontos;
  const habitantes = (pop?.find(([p]) => p === String(ref.ano)) ?? pop?.[pop.length - 1])?.[1];
  const periodoTexto = ref.mesFinal === 12 ? `Em ${ref.ano}` : `De janeiro a ${N.MESES[ref.mesFinal - 1]} de ${ref.ano}`;
  const frases = [
    `${periodoTexto}, a União arrecadou **${reais(total, 2)}** em impostos e contribuições${habitantes ? `, o equivalente a **R$ ${num(total / habitantes, 0)} por habitante**` : ''}.`,
  ];
  const antes = doAno(ref.ano - 1);
  const indice = aux?.ipcaIndice?.pontos;
  if (antes && indice) {
    const fA = N.fatorDeflacao(indice, ref.ano, ref.mesFinal);
    const fB = N.fatorDeflacao(indice, ref.ano - 1, ref.mesFinal);
    if (fA && fB) {
      const v = ((total * fA.fator) / ((antes.receitaTributaria + antes.contribuicoes) * fB.fator) - 1) * 100;
      frases.push(`Descontada a inflação, são ${num(Math.abs(v))}% ${v >= 0 ? 'a mais' : 'a menos'} que no mesmo período de ${ref.ano - 1}.`);
    }
  }
  return { id: 'impostos', tema: 'Impostos', frases, fonte: 'Tesouro Nacional' };
}

function seguranca(seg) {
  const S = seg?.sinesp;
  const ev = S?.eventos?.cvli;
  if (!ev) return null;
  const i = S.meses.length - 1;
  const mes = S.meses[i];
  const v = ev.brasil[i];
  const [ano, m] = mes.split('-').map(Number);
  const dias = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  const soma = (a) => S.meses.reduce((t, p, j) => (p.startsWith(`${a}-`) && Number(p.slice(5, 7)) <= m && ev.brasil[j] != null ? t + ev.brasil[j] : t), 0);
  const acum = soma(ano);
  const acumAntes = soma(ano - 1);
  const frases = [`Em ${mesLongo(mes)}, **${num(v, 0)} pessoas** foram vítimas de mortes violentas intencionais no país, em média ${num(v / dias, 0)} por dia.`];
  if (acumAntes) {
    const d = ((acum - acumAntes) / acumAntes) * 100;
    frases.push(`De janeiro a ${N.MESES[m - 1]} foram ${num(acum, 0)}, ${num(Math.abs(d))}% ${d <= 0 ? 'menos' : 'mais'} que no mesmo período de ${ano - 1}.`);
  }
  const tend = i > 0 && ev.brasil[i - 1] ? N.tendencia(ev.brasil[i - 1], v, 'n', 1, seg.sentido || 'menor-melhor') : null;
  return {
    id: 'seguranca',
    tema: 'Segurança',
    frases,
    tendencia: tend ? { ...tend, texto: `${tend.texto} sobre ${N.rotuloPeriodo(S.meses[i - 1], 'mensal')}` } : null,
    fonte: 'Ministério da Justiça',
  };
}

// Devolve a lista de itens na ordem em que aparecem; itens sem dados ficam de fora.
export function montarResumo(D) {
  const S = D.indicadores?.series || {};
  const aux = D.indicadores?.auxiliares;
  return [
    precos(S, D.indicadores?.metaInflacao),
    juros(S),
    emprego(S),
    renda(S),
    economia(S),
    dolar(S, D.cambio),
    contas(S, aux),
    divida(S),
    impostos(D.orcamento, aux),
    seguranca(D.seguranca),
  ].filter(Boolean);
}
