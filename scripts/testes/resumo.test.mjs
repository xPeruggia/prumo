// Testes do resumo "Em poucas palavras": as frases seguem regras fixas a partir dos dados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarResumo } from '../../assets/js/resumo.js';

const meta = { centro: 3, piso: 1.5, teto: 4.5 };
const ipca = (valor) => ({ ultimo: { periodo: '2026-09', valor }, pontos: [['2026-09', valor]] });
const texto = (item) => item.frases.join(' ');

test('sem dados, o resumo fica vazio em vez de inventar frases', () => {
  assert.deepEqual(montarResumo({}), []);
});

test('inflação acima do teto da meta é dita como tal', () => {
  const [precos] = montarResumo({ indicadores: { series: { ipca12m: ipca(4.58) }, metaInflacao: meta } });
  assert.equal(precos.id, 'precos');
  assert.match(texto(precos), /\*\*R\$ 104,58\*\*/);
  assert.match(texto(precos), /acima do limite da meta/);
});

test('inflação dentro da faixa é dita dentro da meta', () => {
  const [precos] = montarResumo({ indicadores: { series: { ipca12m: ipca(3.2) }, metaInflacao: meta } });
  assert.match(texto(precos), /dentro da meta/);
});

test('o dólar compara com a cotação oficial de um ano antes', () => {
  const cambio = { moedas: [{ codigo: 'USD', pontos: [['2025-10-23', 5.5], ['2026-10-23', 5.0]] }] };
  const dolar = montarResumo({ cambio }).find((i) => i.id === 'dolar');
  assert.match(texto(dolar), /R\$ 5,00/);
  assert.match(texto(dolar), /o real ganhou \*\*10,0%\*\*/);
});
