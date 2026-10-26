// Acesso às APIs oficiais com repetição, tempo-limite e registro de cada chamada.
// O registro vai para data/execucao.json, para que qualquer pessoa veja o que foi consultado.

const AGENTE = 'Prumo/1.0 (observatorio independente de dados publicos)';

export const registro = [];

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export class Vazio extends Error {}

export async function buscar(url, { tipo = 'json', tentativas = 3, tempoLimite = 60000, vazioEm404 = false } = {}) {
  let ultimoErro;
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    const inicio = Date.now();
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': AGENTE, Accept: tipo === 'json' ? 'application/json' : '*/*' },
        signal: AbortSignal.timeout(tempoLimite),
      });
      if (resp.status === 404 && vazioEm404) {
        registro.push({ url, ok: true, status: 404, ms: Date.now() - inicio, nota: 'sem dados no intervalo' });
        throw new Vazio('sem dados');
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const corpo = tipo === 'json' ? await resp.json() : await resp.text();
      registro.push({ url, ok: true, status: resp.status, ms: Date.now() - inicio });
      return corpo;
    } catch (erro) {
      if (erro instanceof Vazio) throw erro;
      ultimoErro = erro;
      registro.push({ url, ok: false, ms: Date.now() - inicio, tentativa, erro: String(erro.message || erro) });
      if (tentativa < tentativas) await esperar(2000 * tentativa);
    }
  }
  throw ultimoErro;
}
