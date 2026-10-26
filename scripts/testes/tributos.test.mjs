// Testes da leitura da arrecadação da Receita Federal e do filtro de propostas que criam tributos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { numeroBr, agruparArrecadacao } from '../tributos.mjs';

const config = JSON.parse(readFileSync(new URL('../../config/tributos.json', import.meta.url), 'utf8'));

test('números de 2001–2002 usam vírgula como separador de milhar', () => {
  assert.equal(numeroBr('47,953,915', 2002), 47953915);
  assert.equal(numeroBr('1,234', 2001), 1234);
});

test('números a partir de 2004 usam vírgula decimal', () => {
  assert.equal(numeroBr('191199,86', 2010), 191199.86);
  assert.equal(numeroBr('123,456', 2010), 123.456);
  assert.equal(numeroBr('1.234.567,8', 2024), 1234567.8);
});

test('células vazias ou inválidas contam como zero', () => {
  assert.equal(numeroBr('', 2024), 0);
  assert.equal(numeroBr(undefined, 2024), 0);
  assert.equal(numeroBr('n/d', 2024), 0);
});

const cabecalho = ['Ano', 'Mês', 'UF', 'IRPF', 'IRPJ - DEMAIS EMPRESAS', 'IRRF - RENDIMENTOS DO TRABALHO', 'COFINS', 'RECEITA PREVIDENCIÁRIA', 'TRIBUTO NOVO'];
const linhas = [
  ['2025', 'Dezembro', 'SP', '10,5', '100', '50', '200', '300', '1'],
  ['2025', 'Dezembro', 'RJ', '4,5', '20', '10', '40', '60', '2'],
  ['2026', 'Janeiro', 'SP', '11', '110', '55', '210', '310', '0'],
  ['2026', 'Janeiro', 'RJ', '5', '22', '11', '42', '62', '0'],
];

test('arrecadação soma todos os estados e agrupa as colunas por tributo', () => {
  const r = agruparArrecadacao(cabecalho, linhas);
  assert.deepEqual(r.meses, ['2025-12', '2026-01']);
  const g = Object.fromEntries(r.grupos.map((x) => [x.id, x]));
  assert.deepEqual(g.ir.valores, [15 + 120 + 60, 16 + 132 + 66]);
  assert.deepEqual(g.cofins.valores, [240, 252]);
  assert.deepEqual(g.previdencia.valores, [360, 372]);
  const partes = Object.fromEntries(g.ir.partes.map((p) => [p.id, p.valores]));
  assert.deepEqual(partes.irpf, [15, 16]);
  assert.deepEqual(partes.irpj, [120, 132]);
  assert.deepEqual(partes.irrfTrabalho, [60, 66]);
});

test('o total é a soma dos grupos, e colunas sem grupo são apontadas em vez de somadas', () => {
  const r = agruparArrecadacao(cabecalho, linhas);
  assert.deepEqual(r.semGrupo, ['TRIBUTO NOVO']);
  assert.deepEqual(r.total, [195 + 240 + 360, 214 + 252 + 372]);
});

test('só os meses mais recentes entram quando pedido', () => {
  const r = agruparArrecadacao(cabecalho, linhas, 1);
  assert.deepEqual(r.meses, ['2026-01']);
});

const padrao = new RegExp(config.propostas.padrao, 'iu');
const exclusoes = new RegExp(config.propostas.exclusoes, 'iu');
const criaTributo = (ementa) => padrao.test(ementa) && !exclusoes.test(ementa);

test('propostas cuja ementa começa criando um tributo entram na lista', () => {
  assert.ok(criaTributo('Institui o Imposto sobre Grandes Fortunas.'));
  assert.ok(criaTributo('Institui a Taxa de Fiscalização Sanitária sobre Apostas de Quota Fixa (TFS-Apostas).'));
  assert.ok(criaTributo('Institui, no âmbito da União, a Contribuição de Intervenção no Domínio Econômico sobre datacenters.'));
  assert.ok(criaTributo('Cria empréstimo compulsório para financiar a reconstrução de áreas atingidas.'));
});

test('propostas que só mencionam tributos ou tratam de taxa de juros ficam de fora', () => {
  assert.ok(!criaTributo('Altera a Lei nº 9.250, de 1995, para instituir dedução no Imposto de Renda.'));
  assert.ok(!criaTributo('Institui taxa de juros máxima para o cartão de crédito.'));
  assert.ok(!criaTributo('Institui o Programa Nacional de Educação Financeira.'));
});
