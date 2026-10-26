// Acesso às APIs oficiais com repetição, tempo-limite e registro de cada chamada.
// O registro vai para data/execucao.json, para que qualquer pessoa veja o que foi consultado.

const AGENTE = 'QuadroReal/1.0 (observatorio independente de dados publicos)';

export const registro = [];

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export class Vazio extends Error {}

// Algumas APIs (como o SGS do Banco Central) às vezes respondem 200 com uma página de erro em XML ou HTML
// quando estão sobrecarregadas. Por isso o JSON é lido como texto, um trecho da resposta inválida vai para
// o registro, e as novas tentativas esperam cada vez mais (3 s, 9 s, 18 s, 30 s).
const ESPERAS = [3000, 9000, 18000, 30000];

// Disjuntor: depois de muitas falhas seguidas no mesmo servidor, as próximas consultas a ele nesta coleta
// fazem uma única tentativa. Assim uma instabilidade longa não estoura o tempo da coleta inteira, e os
// dados anteriores daquela fonte são mantidos e marcados como falha.
const falhasSeguidas = new Map();
const LIMITE_FALHAS_SEGUIDAS = 8;

export async function buscar(url, { tipo = 'json', tentativas = 5, tempoLimite = 60000, vazioEm404 = false } = {}) {
  const host = new URL(url).host;
  if ((falhasSeguidas.get(host) || 0) >= LIMITE_FALHAS_SEGUIDAS) tentativas = 1;
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
      let corpo;
      if (tipo === 'json') {
        const texto = await resp.text();
        try {
          corpo = JSON.parse(texto);
        } catch {
          throw new Error(`resposta não é JSON: ${texto.slice(0, 160).replace(/\s+/g, ' ')}`);
        }
      } else {
        corpo = tipo === 'bytes' ? Buffer.from(await resp.arrayBuffer()) : await resp.text();
      }
      registro.push({ url, ok: true, status: resp.status, ms: Date.now() - inicio });
      falhasSeguidas.set(host, 0);
      return corpo;
    } catch (erro) {
      if (erro instanceof Vazio) {
        falhasSeguidas.set(host, 0);
        throw erro;
      }
      ultimoErro = erro;
      falhasSeguidas.set(host, (falhasSeguidas.get(host) || 0) + 1);
      registro.push({ url, ok: false, ms: Date.now() - inicio, tentativa, erro: String(erro.message || erro) });
      if (tentativa < tentativas) await esperar(ESPERAS[Math.min(tentativa - 1, ESPERAS.length - 1)]);
    }
  }
  throw ultimoErro;
}
