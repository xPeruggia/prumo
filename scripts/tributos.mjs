// Tributos: quanto a União arrecada em cada um (Receita Federal) e quais propostas no Congresso criam novos.

import * as F from './lib/fontes.mjs';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Cada coluna do arquivo da Receita entra em exatamente um grupo; colunas novas sem grupo geram aviso.
export const GRUPOS = [
  { id: 'previdencia', nome: 'Contribuição previdenciária (INSS)', colunas: /^RECEITA PREVIDENCI/ },
  {
    id: 'ir',
    nome: 'Imposto de Renda',
    colunas: /^(IRPF|IRPJ|IRRF)/,
    partes: [
      { id: 'irrfTrabalho', nome: 'Descontado dos salários', colunas: /^IRRF - RENDIMENTOS DO TRABALHO/ },
      { id: 'irpj', nome: 'Pago pelas empresas', colunas: /^IRPJ/ },
      { id: 'irrfCapital', nome: 'Retido em aplicações financeiras', colunas: /^IRRF - RENDIMENTOS DO CAPITAL/ },
      { id: 'irrfExterior', nome: 'Retido em remessas ao exterior', colunas: /^IRRF - REMESSAS/ },
      { id: 'irpf', nome: 'Pago na declaração das pessoas físicas', colunas: /^IRPF$/ },
      { id: 'irrfOutros', nome: 'Outros retidos na fonte', colunas: /^IRRF - OUTROS/ },
    ],
  },
  { id: 'cofins', nome: 'Cofins', colunas: /^COFINS/ },
  { id: 'csll', nome: 'CSLL', colunas: /^CSLL/ },
  { id: 'pis', nome: 'PIS/Pasep', colunas: /^CONTRIBUIÇÃO PARA O PIS/ },
  { id: 'iof', nome: 'IOF', colunas: /^IMPOSTO S\/ OPERAÇÕES FINANCEIRAS/ },
  { id: 'ii', nome: 'Imposto de Importação', colunas: /^IMPOSTO SOBRE IMPORTAÇÃO/ },
  { id: 'ipi', nome: 'IPI', colunas: /^IPI/ },
  { id: 'cpsss', nome: 'Previdência dos servidores federais', colunas: /^(CPSSS|CONTRIBUIÇÃO PLANO SEG)/ },
  { id: 'cide', nome: 'Cide-Combustíveis', colunas: /^CIDE/ },
  { id: 'itr', nome: 'ITR', colunas: /^IMPOSTO TERRITORIAL RURAL/ },
  { id: 'ie', nome: 'Imposto de Exportação', colunas: /^IMPOSTO SOBRE EXPORTAÇÃO/ },
  {
    id: 'outras',
    nome: 'Outras receitas (parcelamentos, receitas de outros órgãos e demais)',
    colunas: /^(OUTRAS RECEITAS|DEMAIS RECEITAS|PAGAMENTO UNIFICADO|REFIS|PAES|RETENÇÃO NA FONTE|CONTRIBUIC[ÕO]ES PARA FUNDAF|IMPOSTO PROVIS|CPMF|ADMINISTRADAS POR OUTROS)/,
  },
];

// O arquivo mistura formatos: em 2001–2002 a vírgula separa milhares ("47,953,915");
// a partir de 2004 a vírgula é decimal ("191199,86", "10,5", "123,456").
export const numeroBr = (v, ano) => {
  let s = String(v ?? '').trim();
  if (!s) return 0;
  if (ano <= 2003 && /^-?\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

// Soma todas as UFs por mês e agrupa as colunas por tributo. Função pura, testada em scripts/testes.
export function agruparArrecadacao(cabecalho, linhas, quantosMeses = 37) {
  const colunas = cabecalho.slice(3).map((nome, i) => ({ nome: nome.trim(), i: i + 3 }));
  const semGrupo = colunas.filter((c) => !GRUPOS.some((g) => g.colunas.test(c.nome))).map((c) => c.nome);
  const porMes = new Map();
  for (const l of linhas) {
    const ano = Number(l[0]);
    const mes = MESES.indexOf(String(l[1]).trim().toLowerCase()) + 1;
    if (!ano || !mes) continue;
    const chave = `${ano}-${String(mes).padStart(2, '0')}`;
    if (!porMes.has(chave)) porMes.set(chave, new Map());
    const soma = porMes.get(chave);
    for (const c of colunas) soma.set(c.nome, (soma.get(c.nome) ?? 0) + numeroBr(l[c.i], ano));
  }
  const meses = [...porMes.keys()].sort().slice(-quantosMeses);
  const somaGrupo = (re) => meses.map((m) => {
    let t = 0;
    for (const [nome, v] of porMes.get(m)) if (re.test(nome)) t += v;
    return Math.round(t * 100) / 100;
  });
  const grupos = GRUPOS.map((g) => ({
    id: g.id,
    nome: g.nome,
    valores: somaGrupo(g.colunas),
    partes: g.partes?.map((p) => ({ id: p.id, nome: p.nome, valores: somaGrupo(p.colunas) })),
  }));
  const total = meses.map((_, i) => Math.round(grupos.reduce((s, g) => s + g.valores[i], 0) * 100) / 100);
  return { meses, grupos, total, semGrupo };
}

export async function coletarTributos(ctx, anterior, avisar, config) {
  const saida = { geradoEm: ctx.agora, receita: anterior?.receita ?? null, propostas: anterior?.propostas ?? null };

  try {
    const { cabecalho, linhas } = await F.arrecadacaoReceita();
    const r = agruparArrecadacao(cabecalho, linhas);
    if (r.semGrupo.length) avisar('tributos', `Colunas novas no arquivo da Receita sem grupo definido: ${r.semGrupo.join(', ')}.`);
    if (!r.meses.length || r.total[r.total.length - 1] <= 0) throw new Error('o arquivo da Receita veio sem valores');
    saida.receita = {
      url: F.URL_ARRECADACAO_RECEITA,
      pagina: 'https://www.gov.br/receitafederal/dados',
      nota: 'Receitas administradas pela Receita Federal, somadas de todos os estados. Valores em reais da época.',
      atualizadoAte: r.meses[r.meses.length - 1],
      ...r,
    };
    console.log(`✓ arrecadação por tributo até ${saida.receita.atualizadoAte}`);
  } catch (e) {
    avisar('tributos', `Arrecadação da Receita: ${e.message}. Mantidos os dados anteriores.`);
  }

  const P = config.propostas;
  try {
    const padrao = new RegExp(P.padrao, 'iu');
    const exclusoes = new RegExp(P.exclusoes, 'iu');
    const encontrados = new Map();
    const anoAtual = Number(ctx.hoje.slice(0, 4));
    for (const tipo of P.tipos) {
      for (let ano = P.anoInicial; ano <= anoAtual; ano++) {
        for (const palavra of P.palavras) {
          for (const p of await F.proposicoesPorPalavra({ siglaTipo: tipo, ano, palavra, maxPaginas: 5 })) {
            const ementa = p.ementa.replace(/\s+/g, ' ').trim();
            const casou = ementa.match(padrao);
            if (!casou || exclusoes.test(ementa)) continue;
            encontrados.set(p.id, { id: p.id, siglaTipo: p.siglaTipo, numero: p.numero, ano: p.ano, ementa, especie: casou[2].toLowerCase() });
          }
        }
      }
    }
    const velhos = new Map((anterior?.propostas?.itens || []).map((i) => [i.id, i]));
    const itens = [];
    for (const item of encontrados.values()) {
      let detalhe = null;
      try {
        detalhe = await F.detalheProposicao(item.id);
      } catch {
        // mantém o que já se sabia sobre a proposição
      }
      const velho = velhos.get(item.id);
      itens.push({
        ...item,
        dataApresentacao: detalhe?.dataApresentacao?.slice(0, 10) ?? velho?.dataApresentacao ?? null,
        situacao: detalhe?.statusProposicao?.descricaoSituacao ?? velho?.situacao ?? null,
        link: F.paginaProposicao(item.id),
      });
    }
    itens.sort((a, b) => ((a.dataApresentacao || '') < (b.dataApresentacao || '') ? 1 : -1));
    saida.propostas = { nota: P.nota, desde: P.anoInicial, itens, atualizadoEm: ctx.agora };
    console.log(`✓ propostas que criam tributos: ${itens.length}`);
  } catch (e) {
    avisar('tributos', `Propostas na Câmara: ${e.message}. Mantida a lista anterior.`);
  }
  return saida;
}

