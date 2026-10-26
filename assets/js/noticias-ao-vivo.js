// O servidor de notícias do IBGE recusa conexões de fora do Brasil, e a coleta automática roda no GitHub (fora do país).
// Quando a coleta registra essa falha, o navegador do leitor busca as notícias do IBGE diretamente na API oficial
// e aplica o mesmo filtro político e a mesma conferência de números usados na coleta (scripts/lib/verificacao.mjs).

const URL_IBGE = 'https://servicodados.ibge.gov.br/api/v3/noticias/?qtd=40';

export function coletaDoIbgeFalhou(noticias) {
  return noticias?.fontes?.some((f) => f.fonte === 'IBGE' && !f.ok) ?? false;
}

export async function buscarIbgeNoNavegador(noticias, series) {
  const [verificacao, filtro, resposta] = await Promise.all([
    import('../../scripts/lib/verificacao.mjs'),
    fetch('config/filtro-politico.json', { cache: 'no-cache' }).then((r) => r.json()),
    fetch(URL_IBGE, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`a API do IBGE respondeu com erro ${r.status}`);
      return r.json();
    }),
  ]);
  const { itens, excluidos } = verificacao.triarNoticias(verificacao.normalizarNoticiasIbge(resposta), series, filtro);
  const porData = (a, b) => (a.publicadoEm < b.publicadoEm ? 1 : -1);
  return {
    ...noticias,
    itens: [...noticias.itens.filter((n) => n.fonte !== 'IBGE'), ...itens].sort(porData).slice(0, 45),
    excluidos: [...noticias.excluidos.filter((n) => n.fonte !== 'IBGE'), ...excluidos].sort(porData),
    ibgeNoNavegador: { estado: 'ok', em: new Date().toISOString() },
  };
}
