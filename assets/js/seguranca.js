// Seção "Segurança e violência": Sinesp (crimes registrados pelas polícias) e Disque 100 (denúncias de discriminação).
// Comparações sempre no mesmo período: mesmo mês de anos diferentes, ou os mesmos meses de cada mandato.

import * as N from './nucleo.js';
import { $, h, alternador, seletor } from './dom.js';
import { graficoLinhas, graficoBarras, tabela, botaoTabela } from './graficos.js';

const NOMES_UF = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
  GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso', PA: 'Pará', PB: 'Paraíba',
  PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima',
  RS: 'Rio Grande do Sul', SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins',
};

const TIPOS_DISQUE = {
  lgbt: { nome: 'LGBTfobia', longo: 'Denúncias de violência contra a população LGBTQIA+', porUf: true },
  homofobia: { nome: 'Homofobia', longo: 'Denúncias de violência contra lésbicas, gays e bissexuais', porUf: false },
  transfobia: { nome: 'Transfobia', longo: 'Denúncias de violência contra pessoas trans e travestis', porUf: false },
  religiosa: { nome: 'Intolerância religiosa', longo: 'Denúncias de violação da liberdade religiosa e racismo religioso', porUf: true },
};

const DESTAQUES = ['cvli', 'feminicidio', 'estupro', 'rouboVeiculo', 'furtoVeiculo'];

const inteiro = (v) => (v == null ? '—' : N.formatarNumero(v, 0));
const pct = (v) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${N.formatarNumero(v, 1)}%`);
const variacao = (de, para) => (de ? ((para - de) / de) * 100 : null);
const mesCurto = (m) => N.MESES_CURTOS[Number(m.slice(5, 7)) - 1];

const estado = {
  indicador: 'cvli',
  uf: 'BR',
  visao: 'anos',
  modoMandato: 'acumulado',
  tipo: 'lgbt',
  religiao: 'todas',
  ufDisque: 'BR',
  visaoDisque: 'anos',
  modoMandatoDisque: 'acumulado',
};

let dadosUf = null;
async function carregarUf() {
  if (dadosUf) return dadosUf;
  dadosUf = await fetch('data/seguranca-uf.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return dadosUf;
}

// replaceChildren transforma null em texto "null"; os painéis passam por aqui para descartar itens condicionais.
const conteudo = (...itens) => itens.filter((i) => i != null && i !== false);

// ---------- Acesso aos dados ----------

function valoresSinesp(S, id, uf) {
  if (uf === 'BR') return S.eventos[id].brasil;
  return dadosUf?.sinesp?.[id]?.[uf] ?? null;
}

function valoresDisque(Q, tipo, religiao, uf) {
  if (tipo === 'religiosa' && religiao !== 'todas') return Q.porReligiao[religiao];
  if (uf !== 'BR') return dadosUf?.disque100?.[tipo]?.[uf] ?? null;
  return Q.series[tipo];
}

function totalAno(meses, valores, ano, ateMes = 12) {
  let soma = 0;
  let n = 0;
  meses.forEach((m, i) => {
    if (m.startsWith(`${ano}-`) && Number(m.slice(5, 7)) <= ateMes && valores[i] != null) {
      soma += valores[i];
      n++;
    }
  });
  return n === ateMes ? soma : null;
}

function populacaoDoAno(pop, ano) {
  if (!pop?.length) return null;
  const mapa = new Map(pop.map(([a, v]) => [Number(a), v]));
  if (mapa.has(ano)) return mapa.get(ano);
  const anos = [...mapa.keys()].sort((a, b) => a - b);
  const antes = anos.filter((a) => a < ano).pop();
  const depois = anos.find((a) => a > ano);
  if (antes == null || depois == null) return null;
  return mapa.get(antes) + ((mapa.get(depois) - mapa.get(antes)) * (ano - antes)) / (depois - antes);
}

// ---------- Gráficos compartilhados pelos dois painéis ----------

function graficoAnoAAno(alvo, meses, valores, titulo, unidade) {
  const anos = [...new Set(meses.map((m) => Number(m.slice(0, 4))))];
  const ultimo = anos[anos.length - 1];
  const series = anos
    .map((ano) => {
      const pontos = [];
      meses.forEach((m, i) => {
        if (m.startsWith(`${ano}-`) && valores[i] != null) pontos.push([Number(m.slice(5, 7)) - 1, valores[i]]);
      });
      const destaque = ano === ultimo ? 'var(--serie-1)' : ano === ultimo - 1 ? 'var(--serie-2)' : null;
      return { nome: String(ano), cor: destaque ?? 'var(--tinta-3)', fraco: !destaque, rotulo: Boolean(destaque), pontos };
    })
    .filter((s) => s.pontos.length);
  // Anos antigos primeiro, para que os dois anos em destaque fiquem desenhados por cima.
  graficoLinhas(alvo, {
    titulo,
    series,
    altura: 290,
    incluirZero: true,
    dominioX: [0, 11],
    marcasX: (_a, _b, largura) => N.MESES_CURTOS.map((m, x) => ({ x, rotulo: largura < 480 && x % 2 ? '' : m })),
    formatoEixo: (v) => N.formatarNumero(v, 0),
    formatoRotulo: (v, s) => `${s.nome}: ${inteiro(v)}`,
    formatoDica: (v) => `${inteiro(v)} ${unidade}`,
    rotuloX: (x) => N.MESES[x],
  });
  return series;
}

function graficoMandatos(alvo, meses, valores, mandatos, comparacao, modo, titulo, unidade) {
  const pares = N.paresMensais(meses, valores);
  const [idA, idB] = comparacao;
  const series = mandatos
    .map((m) => {
      const cor = m.id === idA ? 'var(--serie-1)' : m.id === idB ? 'var(--serie-2)' : 'var(--tinta-3)';
      const pontos = modo === 'acumulado' ? N.acumuladoNoMandato(pares, m) : N.alinhar(pares, m).serie.map((p) => [p.k, p.valor]);
      return { nome: m.rotulo, cor, fraco: cor === 'var(--tinta-3)', pontos };
    })
    .filter((s) => s.pontos.length);
  graficoLinhas(alvo, {
    titulo,
    series,
    altura: 290,
    incluirZero: true,
    dominioX: [1, 48],
    marcasX: () => [1, 12, 24, 36, 48].map((x) => ({ x, rotulo: x === 1 ? 'mês 1' : `mês ${x}` })),
    formatoEixo: (v) => (Math.abs(v) >= 1e4 ? `${N.formatarNumero(v / 1000, 0)} mil` : N.formatarNumero(v, 0)),
    formatoRotulo: (v, s) => `${s.nome}: ${Math.abs(v) >= 1e5 ? `${N.formatarNumero(v / 1000, 0)} mil` : inteiro(v)}`,
    formatoDica: (v) => `${inteiro(v)} ${unidade}`,
    rotuloX: (x) => `Mês ${x} de mandato`,
  });
  return series;
}

function graficoSerie(alvo, meses, valores, faixas, titulo, unidade) {
  graficoLinhas(alvo, {
    titulo,
    series: [{ nome: titulo, cor: 'var(--serie-1)', pontos: N.paresMensais(meses, valores).map(([m, v]) => [N.indiceMes(m), v]) }],
    faixas,
    area: true,
    incluirZero: true,
    altura: 290,
    marcasX: (xMin, xMax, largura) => {
      const marcas = [];
      const passo = largura < 520 ? 2 : 1;
      for (let a = Math.ceil(xMin / 12); a * 12 <= xMax; a += passo) marcas.push({ x: a * 12, rotulo: String(a) });
      return marcas;
    },
    formatoEixo: (v) => N.formatarNumero(v, 0),
    formatoRotulo: (v) => inteiro(v),
    formatoDica: (v) => `${inteiro(v)} ${unidade}`,
    rotuloX: (x) => N.rotuloPeriodo(N.periodoDeIndice(x), 'mensal', { longo: true }),
  });
}

function legendaDe(series) {
  const fortes = series.filter((s) => !s.fraco);
  const temFracas = series.some((s) => s.fraco);
  return h('div', { class: 'legenda' },
    fortes.map((s) => h('span', {}, h('i', { style: `background:${s.cor}` }), s.nome)),
    temFracas ? h('span', {}, h('i', { style: 'background:var(--tinta-3);opacity:.5' }), 'Demais períodos') : null,
  );
}

function tabelaAnual(meses, valores, unidade, pop, ufsComDados) {
  const anos = [...new Set(meses.map((m) => Number(m.slice(0, 4))))].reverse();
  const ultimoMes = Number(meses[meses.length - 1].slice(5, 7));
  const rotuloParcial = `Jan–${mesCurto(meses[meses.length - 1])}`;
  const linhas = anos.map((ano) => {
    const completo = totalAno(meses, valores, ano, 12);
    const parcial = totalAno(meses, valores, ano, ultimoMes);
    const parcialAnterior = totalAno(meses, valores, ano - 1, ultimoMes);
    const p = pop ? populacaoDoAno(pop, ano) : null;
    const cobertura = ufsComDados ? Math.min(...ufsComDados.filter((_, i) => meses[i].startsWith(`${ano}-`))) : null;
    return [
      String(ano),
      inteiro(completo),
      inteiro(parcial),
      pct(parcial != null && parcialAnterior != null ? variacao(parcialAnterior, parcial) : null),
      ...(pop ? [completo != null && p ? N.formatarNumero((completo / p) * 1e5, 1) : '—'] : []),
      ...(ufsComDados ? [String(cobertura)] : []),
    ];
  });
  return tabela(
    [
      'Ano',
      `Ano inteiro (${unidade})`,
      rotuloParcial,
      `Variação ${rotuloParcial} sobre o ano anterior`,
      ...(pop ? ['Por 100 mil habitantes'] : []),
      ...(ufsComDados ? ['Estados com dados (mínimo no ano)'] : []),
    ],
    linhas,
    'Totais por ano',
  );
}

// ---------- Placar do último mês ----------

function placar(S) {
  const ultimo = S.meses[S.meses.length - 1];
  const i = S.meses.length - 1;
  const iAnoAntes = S.meses.indexOf(N.periodoDeIndice(N.indiceMes(ultimo) - 12));
  const ano = Number(ultimo.slice(0, 4));
  const ateMes = Number(ultimo.slice(5, 7));
  const blocos = DESTAQUES.filter((id) => S.eventos[id]).map((id) => {
    const ev = S.eventos[id];
    const v = ev.brasil[i];
    const antes = iAnoAntes >= 0 ? ev.brasil[iAnoAntes] : null;
    const acum = totalAno(S.meses, ev.brasil, ano, ateMes);
    const acumAntes = totalAno(S.meses, ev.brasil, ano - 1, ateMes);
    return h('div', {},
      h('div', { class: 'placar__mandato', texto: ev.nome.replace(/ \(.+\)$/, '') }),
      h('div', { class: 'placar__numero', texto: inteiro(v) }),
      h('div', { class: 'placar__detalhe', texto: `${ev.unidade} em ${N.rotuloPeriodo(ultimo, 'mensal')}; ${pct(variacao(antes, v))} sobre ${N.rotuloPeriodo(N.periodoDeIndice(N.indiceMes(ultimo) - 12), 'mensal')}` }),
      h('div', { class: 'placar__detalhe', texto: `Jan–${mesCurto(ultimo)}: ${inteiro(acum)} (${pct(variacao(acumAntes, acum))} sobre ${ano - 1})` }),
    );
  });
  return blocos;
}

function placarDisque(Q) {
  const j = Q.meses.length - 1;
  const ultimo = Q.meses[j];
  const anoAntes = N.periodoDeIndice(N.indiceMes(ultimo) - 12);
  const jAntes = Q.meses.indexOf(anoAntes);
  return Object.entries(TIPOS_DISQUE).map(([tipo, t]) => {
    const v = Q.series[tipo][j];
    const antes = jAntes >= 0 ? Q.series[tipo][jAntes] : null;
    return h('div', {},
      h('div', { class: 'placar__mandato', texto: t.nome }),
      h('div', { class: 'placar__numero', texto: inteiro(v) }),
      h('div', { class: 'placar__detalhe', texto: `denúncias em ${N.rotuloPeriodo(ultimo, 'mensal')}; ${antes != null ? `${pct(variacao(antes, v))} sobre ${N.rotuloPeriodo(anoAntes, 'mensal')}` : 'sem o mesmo mês do ano anterior'}` }),
    );
  });
}

// ---------- Painel Sinesp ----------

function opcoesIndicadores(S) {
  return S.grupos.map((g) => ({
    rotulo: g.nome,
    opcoes: Object.values(S.eventos)
      .filter((e) => e.grupo === g.id)
      .sort((a, b) => (a.composto ? -1 : 0) - (b.composto ? -1 : 0))
      .map((e) => [e.id, e.nome]),
  }));
}

const opcoesLocal = (temUf) => [['BR', 'Brasil'], ...(temUf ? Object.entries(NOMES_UF).map(([sigla, nome]) => [sigla, nome]) : [])];

function renderPainelSinesp(D) {
  const S = D.seguranca.sinesp;
  const E = estado;
  const ev = S.eventos[E.indicador];
  const valores = valoresSinesp(S, E.indicador, E.uf);
  const local = E.uf === 'BR' ? 'Brasil' : NOMES_UF[E.uf];
  const rerender = (campo) => async (v) => {
    E[campo] = v;
    if (campo === 'uf' && v !== 'BR') await carregarUf();
    renderPainelSinesp(D);
  };

  const controles = h('div', { class: 'controles' },
    h('label', { class: 'campo' }, h('span', { class: 'controle-rotulo', texto: 'Indicador' }), seletor('Indicador', opcoesIndicadores(S), E.indicador, rerender('indicador'))),
    h('label', { class: 'campo' }, h('span', { class: 'controle-rotulo', texto: 'Local' }), seletor('Local', opcoesLocal(true), E.uf, rerender('uf'))),
    h('div', {}, h('span', { class: 'controle-rotulo', texto: 'Comparar' }),
      alternador('Comparar', [['anos', 'Mês a mês, ano a ano'], ['mandatos', 'Por mandato'], ['serie', 'Série completa']], E.visao, rerender('visao'))),
    E.visao === 'mandatos'
      ? h('div', {}, alternador('Forma', [['acumulado', 'Acumulado'], ['mensal', 'Mês a mês']], E.modoMandato, rerender('modoMandato')))
      : null,
  );

  const graf = h('div');
  const legenda = h('div');
  const corpo = h('div', {}, legenda, graf);
  const ultimo = S.meses[S.meses.length - 1];
  const ufs = ev.ufsComDados?.[ev.ufsComDados.length - 1];
  const notas = [
    `${ev.descricao ?? ''} Unidade: ${ev.unidade}.`,
    E.uf === 'BR' && ufs != null ? `Em ${N.rotuloPeriodo(ultimo, 'mensal')}, ${ufs} das 27 unidades da federação enviaram dados.` : '',
    ['homicidio', 'homicidioDoloso', 'feminicidio', 'cvli'].includes(E.indicador) ? S.notaFeminicidio : '',
  ].filter(Boolean);

  $('painel-sinesp').replaceChildren(...conteudo(
    h('div', { class: 'painel__topo' },
      h('div', {},
        h('h3', { class: 'subtitulo', texto: `${ev.nome}, ${local}` }),
        h('p', { class: 'legenda-painel', texto: `Registros das polícias estaduais enviados ao Ministério da Justiça (Sinesp), de jan/2015 a ${N.rotuloPeriodo(ultimo, 'mensal')}.` }),
      ),
    ),
    controles,
    !valores ? h('p', { class: 'legenda-painel', texto: 'Carregando os dados do estado…' }) : corpo,
    h('div', { class: 'notas-painel' }, notas.map((t) => h('p', { texto: t }))),
    h('div', { class: 'painel__rodape' },
      h('span', {}, 'Fonte: Ministério da Justiça e Segurança Pública, Sinesp VDE. ', h('a', { href: S.pagina, target: '_blank', rel: 'noopener', texto: 'Planilhas originais e notas dos estados' })),
      valores
        ? botaoTabela(corpo, () =>
            tabelaAnual(S.meses, valores, ev.unidade, E.uf === 'BR' ? D.indicadores.auxiliares?.populacao?.pontos : null, E.uf === 'BR' ? ev.ufsComDados : null))
        : null,
    ),
  ));
  if (!valores) return;
  const titulo = `${ev.nome}, ${local}`;
  let series;
  if (E.visao === 'anos') series = graficoAnoAAno(graf, S.meses, valores, titulo, ev.unidade);
  else if (E.visao === 'mandatos') series = graficoMandatos(graf, S.meses, valores, D.mandatos.mandatos, D.mandatos.comparacao, E.modoMandato, titulo, ev.unidade);
  else graficoSerie(graf, S.meses, valores, faixasDeMandatos(D), titulo, ev.unidade);
  if (series) legenda.replaceChildren(legendaDe(series));
}

function faixasDeMandatos(D) {
  return D.mandatos.mandatos.map((m) => ({ rotulo: m.rotulo, de: N.indiceMes(m.inicio.slice(0, 7)), ate: N.indiceMes(m.fim.slice(0, 7)) }));
}

// ---------- Painel Disque 100 ----------

function renderPainelDisque(D) {
  const Q = D.seguranca.disque100;
  if (!Q) {
    $('painel-disque').replaceChildren(h('p', { class: 'legenda-painel', texto: 'Os microdados do Disque 100 ainda não foram processados.' }));
    return;
  }
  const E = estado;
  const tipo = TIPOS_DISQUE[E.tipo];
  if (!tipo.porUf) E.ufDisque = 'BR';
  if (E.tipo !== 'religiosa') E.religiao = 'todas';
  if (E.religiao !== 'todas') E.ufDisque = 'BR';
  const valores = valoresDisque(Q, E.tipo, E.religiao, E.ufDisque);
  const rerender = (campo) => async (v) => {
    E[campo] = v;
    if (campo === 'ufDisque' && v !== 'BR') await carregarUf();
    renderPainelDisque(D);
  };
  const religiao = Q.religioes.find((r) => r.id === E.religiao);
  const local = E.ufDisque === 'BR' ? 'Brasil' : NOMES_UF[E.ufDisque];
  const titulo = `${tipo.longo}${religiao ? `, vítimas de religião ${religiao.nome.toLowerCase()}` : ''}, ${local}`;
  const primeiroTrans = Q.meses[Q.series.transfobia.findIndex((v) => v != null)];

  const controles = h('div', { class: 'controles' },
    h('div', {}, h('span', { class: 'controle-rotulo', texto: 'Tipo' }),
      alternador('Tipo de denúncia', Object.entries(TIPOS_DISQUE).map(([id, t]) => [id, t.nome]), E.tipo, rerender('tipo'))),
    E.tipo === 'religiosa'
      ? h('label', { class: 'campo' }, h('span', { class: 'controle-rotulo', texto: 'Religião da vítima' }),
          seletor('Religião da vítima', [['todas', 'Todas'], ...Q.religioes.map((r) => [r.id, r.nome])], E.religiao, rerender('religiao')))
      : null,
    tipo.porUf && E.religiao === 'todas'
      ? h('label', { class: 'campo' }, h('span', { class: 'controle-rotulo', texto: 'Local' }), seletor('Local', opcoesLocal(true), E.ufDisque, rerender('ufDisque')))
      : null,
    h('div', {}, h('span', { class: 'controle-rotulo', texto: 'Comparar' }),
      alternador('Comparar', [['anos', 'Mês a mês, ano a ano'], ['mandatos', 'Por mandato'], ['serie', 'Série completa']], E.visaoDisque, rerender('visaoDisque'))),
    E.visaoDisque === 'mandatos'
      ? h('div', {}, alternador('Forma', [['acumulado', 'Acumulado'], ['mensal', 'Mês a mês']], E.modoMandatoDisque, rerender('modoMandatoDisque')))
      : null,
  );

  const graf = h('div');
  const legenda = h('div');
  const corpo = h('div', {}, legenda, graf);
  const notas = [
    'São denúncias recebidas pelo canal, não crimes confirmados pela polícia ou pela Justiça. Uma denúncia pode envolver mais de uma vítima e mais de uma violação; aqui cada denúncia conta uma vez.',
    'Mais denúncias podem refletir mais violência ou mais divulgação e confiança no canal; os dois efeitos não se separam nestes dados.',
    E.tipo === 'homofobia' ? 'Homofobia: denúncias registradas no grupo LGBTQIA+ em que a vítima é lésbica, gay, bissexual ou pansexual.' : '',
    E.tipo === 'transfobia' ? `Transfobia: denúncias do grupo LGBTQIA+ com vítima identificada como pessoa trans ou travesti. O Disque 100 só passou a registrar essa identificação a partir de ${primeiroTrans ? N.rotuloPeriodo(primeiroTrans, 'mensal') : 'data posterior'}; antes disso a série fica em branco.` : '',
    E.tipo === 'religiosa' ? 'Intolerância religiosa: denúncias com violação da liberdade de religião ou crença, ou de racismo religioso. A religião da vítima não é informada em parte das denúncias, e essa parcela muda de ano para ano (aparece como “Não informada” no gráfico por religião). Comparações por religião entre anos devem considerar isso.' : '',
    'O sistema do Disque 100 mudou de categorias em 2023. Os microdados neste formato começam em jul/2020; o arquivo do 1º semestre de 2020 usa outro formato e não foi incluído.',
  ].filter(Boolean);

  $('painel-disque').replaceChildren(...conteudo(
    h('div', { class: 'painel__topo' },
      h('div', {},
        h('h3', { class: 'subtitulo', texto: titulo }),
        h('p', { class: 'legenda-painel', texto: `Microdados do Disque 100 (Ministério dos Direitos Humanos), de ${N.rotuloPeriodo(Q.meses[0], 'mensal')} a ${N.rotuloPeriodo(Q.atualizadoAte, 'mensal')}.` }),
      ),
    ),
    h('div', { class: 'placar placar--seguranca placar--interno' }, placarDisque(Q)),
    controles,
    valores ? corpo : h('p', { class: 'legenda-painel', texto: 'Carregando os dados do estado…' }),
    E.tipo === 'religiosa' && E.religiao === 'todas' ? painelReligioes(Q) : null,
    E.ufDisque === 'BR' ? conferenciaOficial(Q, E.tipo) : null,
    h('div', { class: 'notas-painel' }, notas.map((t) => h('p', { texto: t }))),
    h('div', { class: 'painel__rodape' },
      h('span', {}, 'Fonte: Ministério dos Direitos Humanos e da Cidadania, Disque 100. ', h('a', { href: Q.pagina, target: '_blank', rel: 'noopener', texto: 'Microdados originais' })),
      valores ? botaoTabela(corpo, () => tabelaAnual(Q.meses, valores, 'denúncias', null)) : null,
    ),
  ));
  if (!valores) return;
  let series;
  if (E.visaoDisque === 'anos') series = graficoAnoAAno(graf, Q.meses, valores, titulo, 'denúncias');
  else if (E.visaoDisque === 'mandatos') series = graficoMandatos(graf, Q.meses, valores, D.mandatos.mandatos, D.mandatos.comparacao, E.modoMandatoDisque, titulo, 'denúncias');
  else graficoSerie(graf, Q.meses, valores, faixasDeMandatos(D), titulo, 'denúncias');
  if (series) legenda.replaceChildren(legendaDe(series));
}

// Nossa contagem comparada com totais que o ministério divulgou. Os números oficiais ficam na configuração,
// com a fonte; a nossa soma é recalculada dos dados a cada atualização.
function conferenciaOficial(Q, tipo) {
  const itens = (Q.conferencias || []).filter((c) => c.serie === tipo);
  if (!itens.length) return null;
  const linhas = itens.map((c) => {
    let soma = 0;
    let completos = true;
    for (let i = N.indiceMes(c.de); i <= N.indiceMes(c.ate); i++) {
      const v = Q.series[c.serie][Q.meses.indexOf(N.periodoDeIndice(i))];
      if (v == null) completos = false;
      else soma += v;
    }
    return [c.rotulo, inteiro(c.oficial), completos ? inteiro(soma) : '—', completos ? pct(variacao(c.oficial, soma)) : '—'];
  });
  return h('div', { style: 'margin-top:24px' },
    h('h4', { class: 'subtitulo', style: 'font-size:var(--texto-m)', texto: 'Conferência com os balanços oficiais' }),
    h('p', { class: 'legenda-painel', texto: 'Totais divulgados pelo ministério comparados com a soma dos microdados feita aqui. Os balanços saíram antes de os microdados serem consolidados; diferenças pequenas podem vir de registros incluídos depois e da data usada como referência.' }),
    tabela(['Período', 'Balanço oficial', 'Soma dos microdados', 'Diferença'], linhas, 'Conferência com balanços oficiais'),
    h('p', { class: 'legenda-painel', style: 'margin-top:8px' }, 'Fonte dos balanços: ', h('a', { href: itens[0].url, target: '_blank', rel: 'noopener', texto: itens[0].fonte })),
  );
}

function painelReligioes(Q) {
  // Últimos 12 meses com dados; um mês ausente nunca entra como zero.
  const indices = Q.meses.map((_, i) => i).filter((i) => Q.series.religiosa[i] != null).slice(-12);
  if (!indices.length) return null;
  const inicio = Q.meses[indices[0]];
  const fim = Q.meses[indices[indices.length - 1]];
  const itens = Q.religioes
    .map((r) => ({ rotulo: r.nome, valor: indices.reduce((s, i) => s + (Q.porReligiao[r.id][i] ?? 0), 0) }))
    .filter((i) => i.valor > 0)
    .sort((a, b) => b.valor - a.valor);
  const graf = h('div');
  const consecutivos = N.indiceMes(fim) - N.indiceMes(inicio) + 1 === indices.length;
  const bloco = h('div', { style: 'margin-top:24px' },
    h('h4', { class: 'subtitulo', style: 'font-size:var(--texto-m)', texto: `Religião da vítima nas denúncias de intolerância religiosa, ${N.rotuloPeriodo(inicio, 'mensal')} a ${N.rotuloPeriodo(fim, 'mensal')}${consecutivos ? '' : ` (${indices.length} meses com dados)`}` }),
    graf,
  );
  requestAnimationFrame(() => graficoBarras(graf, { titulo: 'Denúncias de intolerância religiosa por religião da vítima', itens, formato: (v) => `${inteiro(v)} denúncias` }));
  return bloco;
}

// ---------- Comparativo entre mandatos ----------

export function painelSegurancaMandatos(D) {
  const S = D.seguranca?.sinesp;
  const Q = D.seguranca?.disque100;
  const alvo = $('painel-seguranca-mandatos');
  if (!S || !alvo) return;
  const M = D.mandatos.mandatos;
  // N = meses de dados do mandato mais recente que já tem dados; todos os mandatos são somados até esse mesmo mês.
  const mesesDisponiveis = (meses, valores, m) => N.alinhar(N.paresMensais(meses, valores), m).serie.length;
  const recente = [...M].reverse().find((m) => mesesDisponiveis(S.meses, S.eventos.cvli.brasil, m) > 0);
  const n = mesesDisponiveis(S.meses, S.eventos.cvli.brasil, recente);
  const nDisque = Q ? mesesDisponiveis(Q.meses, Q.series.total, recente) : 0;
  const ids = ['cvli', 'homicidio', 'feminicidio', 'latrocinio', 'estupro', 'estuproVulneravel', 'rouboVeiculo', 'furtoVeiculo', 'rouboCarga', 'intervencao'];
  let algumaCoberturaParcial = false;
  const linhas = ids.filter((id) => S.eventos[id]).map((id) => {
    const ev = S.eventos[id];
    const pares = N.paresMensais(S.meses, ev.brasil);
    const somas = M.map((m) => N.somaNoMandato(pares, m, n));
    // Menor número de estados que enviaram o dado em algum mês do período somado.
    const cobertura = M.map((m) => {
      const ini = S.meses.indexOf(m.inicio.slice(0, 7));
      if (ini < 0) return null;
      const trecho = ev.ufsComDados.slice(ini, ini + n);
      return trecho.length ? Math.min(...trecho) : null;
    });
    return [
      ev.nome,
      ...somas.map((v, i) => {
        if (v == null) return '—';
        const parcial = cobertura[i] != null && cobertura[i] < 27;
        if (parcial) algumaCoberturaParcial = true;
        return `${inteiro(v)}${parcial ? '*' : ''}${i && somas[i - 1] ? ` (${pct(variacao(somas[i - 1], v))})` : ''}`;
      }),
    ];
  });
  if (Q) {
    for (const tipo of ['lgbt', 'religiosa']) {
      const pares = N.paresMensais(Q.meses, Q.series[tipo]);
      const somas = M.map((m) => N.somaNoMandato(pares, m, nDisque));
      linhas.push([`Denúncias de ${TIPOS_DISQUE[tipo].nome === 'LGBTfobia' ? 'LGBTfobia' : 'intolerância religiosa'} (Disque 100, ${nDisque} meses)`, ...somas.map((v, i) => (v == null ? '—' : `${inteiro(v)}${i && somas[i - 1] ? ` (${pct(variacao(somas[i - 1], v))})` : ''}`))]);
    }
  }
  const tab = tabela(['Indicador', ...M.map((m) => `Mandato ${m.rotulo}`)], linhas, 'Segurança no mesmo período de cada mandato');
  tab.querySelector('table').classList.add('tabela-mandatos');
  alvo.replaceChildren(
    h('div', { class: 'painel__topo' },
      h('div', {},
        h('h3', { class: 'subtitulo', texto: `Segurança nos primeiros ${n} meses de cada mandato` }),
        h('p', { class: 'legenda-painel', texto: `Soma dos ${n} primeiros meses de governo de cada mandato, o período que o mandato ${recente.rotulo} já tem de dados. Entre parênteses, a variação sobre o mandato anterior. “—” indica que a fonte não cobre todos esses meses.` }),
      ),
    ),
    tab,
    algumaCoberturaParcial
      ? h('p', { class: 'legenda-painel', style: 'margin-top:12px', texto: '* Em parte desse período, nem todas as 27 unidades da federação enviaram o dado ao Sinesp. A variação pode refletir a entrada de estados na base, e não só mudança no número de casos.' })
      : h('span'),
    h('div', { class: 'painel__rodape' }, h('span', { texto: 'Fontes: Sinesp (Ministério da Justiça) e Disque 100 (Ministério dos Direitos Humanos). Os microdados do Disque 100 começam em jul/2020, por isso os mandatos anteriores ficam sem total comparável.' })),
  );
}

// ---------- Entrada ----------

export function renderSeguranca(D) {
  const S = D.seguranca?.sinesp;
  if (!S) {
    $('placar-seguranca').replaceChildren(h('p', { class: 'legenda-painel', texto: 'Os dados de segurança ainda não foram coletados.' }));
    return;
  }
  $('placar-seguranca').replaceChildren(...placar(S));
  renderPainelSinesp(D);
  renderPainelDisque(D);
}
