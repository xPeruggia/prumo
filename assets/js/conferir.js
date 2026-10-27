// Conferência feita pelo próprio leitor: o navegador consulta a API oficial
// (Banco Central ou IBGE) e compara com o número publicado aqui. Nada passa pelo servidor do site.

const NS = 'http://www.w3.org/2000/svg';
let contador = 0;

export async function conferirNoNavegador(consultas) {
  return Promise.all(
    consultas.map(async (q) => {
      try {
        const resp = await fetch(q.url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (!resp.ok) throw new Error(`a API respondeu com erro ${resp.status}`);
        const dados = await resp.json();
        let valor = q.tipo === 'sgs' ? Number(dados[dados.length - 1]?.valor) : Number(dados[1]?.V);
        if (q.inverterSinal) valor = valor === 0 ? 0 : -valor;
        if (!Number.isFinite(valor)) throw new Error('a API não devolveu um valor numérico');
        const ok = Math.abs(valor - q.valorEsperado) <= 1e-9 * Math.max(1, Math.abs(q.valorEsperado));
        return { ...q, valorObtido: valor, ok };
      } catch (e) {
        return { ...q, ok: null, erro: e.message === 'Failed to fetch' ? 'a API não respondeu (rede ou bloqueio do navegador)' : e.message };
      }
    }),
  );
}

// Lacre da abertura: o selo de cera do site, com o resultado da conferência do dia escrito embaixo.
export function lacre({ data, diverge = false, batido = false }) {
  const figura = document.createElement('figure');
  figura.className = `lacre${diverge ? ' lacre--diverge' : ''}${batido ? ' lacre--batido' : ''}`;
  const img = document.createElement('img');
  Object.assign(img, { src: 'assets/img/selo-240.png', alt: '', width: 120, height: 128, decoding: 'async' });
  const legenda = document.createElement('figcaption');
  const titulo = document.createElement('b');
  titulo.textContent = diverge ? 'Não confere com o original' : 'Confere com o original';
  const quando = document.createElement('span');
  quando.textContent = data;
  legenda.append(titulo, quando);
  figura.append(img, legenda);
  return figura;
}

// Carimbo "confere com o original", o gesto de cartório que dá nome à verificação.
export function carimbo({ data, diverge = false, batido = false }) {
  const id = `tinta-${++contador}`;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 240 112');
  svg.setAttribute('class', `carimbo${diverge ? ' carimbo--diverge' : ''}${batido ? ' carimbo--batido' : ''}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', diverge ? `Carimbo: não confere, ${data}` : `Carimbo: confere com o original, ${data}`);
  const linha1 = diverge ? 'NÃO CONFERE COM' : 'CONFERE COM O';
  const linha2 = diverge ? 'O ORIGINAL' : 'ORIGINAL';
  svg.innerHTML = `
    <defs>
      <filter id="${id}" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${contador * 7}" result="ruido"/>
        <feColorMatrix in="ruido" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 2" result="falhas"/>
        <feComposite in="SourceGraphic" in2="falhas" operator="in"/>
      </filter>
    </defs>
    <g filter="url(#${id})" fill="none" stroke="currentColor">
      <rect x="3" y="3" width="234" height="106" rx="12" stroke-width="3.2"/>
      <rect x="10" y="10" width="220" height="92" rx="7" stroke-width="1.2"/>
      <line x1="22" y1="58" x2="218" y2="58" stroke-width="1.2"/>
      <line x1="22" y1="82" x2="218" y2="82" stroke-width="1.2"/>
      <g stroke="none">
        <text x="120" y="38" text-anchor="middle" font-size="19" font-weight="800" letter-spacing="1.6" style="font-variation-settings:'wdth' 78">${linha1}</text>
        <text x="120" y="54" text-anchor="middle" font-size="13" font-weight="700" letter-spacing="3" style="font-variation-settings:'wdth' 90">${linha2}</text>
        <text x="120" y="76" text-anchor="middle" font-size="17" font-weight="800" letter-spacing="2.4" style="font-variation-settings:'wdth' 96">${data}</text>
        <text x="120" y="97" text-anchor="middle" font-size="9" font-weight="700" letter-spacing="1.2" style="font-variation-settings:'wdth' 86">QUADRO REAL  VERIFICAÇÃO DIÁRIA</text>
      </g>
    </g>`;
  return svg;
}
