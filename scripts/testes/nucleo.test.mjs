// Testes da lógica que decide o que é comparado com o quê. Rodam antes de cada coleta automática.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compararMandatos, alinhar, fatorDeflacao, diferenca, rotuloPeriodo, mandatoEm, hojeBrasilia, periodoDeIndice, indiceMes, tendencia } from '../../assets/js/nucleo.js';

const A = { id: '2023-2026', inicio: '2023-01-01', fim: '2027-01-05' };
const B = { id: '2027-2030', inicio: '2027-01-05', fim: '2031-01-05' };

function serieMensal(de, ate, valor = (i) => i) {
  const pontos = [];
  for (let i = indiceMes(de), n = 0; i <= indiceMes(ate); i++, n++) pontos.push([periodoDeIndice(i), valor(n)]);
  return pontos;
}

test('mandato 2023–2026 tem 48 meses e recebe o dado de dezembro de 2022', () => {
  const r = alinhar(serieMensal('2022-01', '2026-12'), A);
  assert.equal(r.totalMeses, 48);
  assert.equal(r.base.periodo, '2022-12');
  assert.equal(r.serie[0].periodo, '2023-01');
  assert.equal(r.serie[0].k, 1);
  assert.equal(r.serie.at(-1).k, 48);
});

test('janeiro de 2027 pertence ao novo mandato (posse em 5/1)', () => {
  const r = compararMandatos(serieMensal('2022-01', '2027-01'), A, B);
  assert.equal(r.B.base.periodo, '2026-12');
  assert.equal(r.B.atual.periodo, '2027-01');
  assert.equal(r.A.final.periodo, '2026-12');
});

test('antes da posse não há comparação no mesmo ponto', () => {
  const r = compararMandatos(serieMensal('2022-01', '2026-09'), A, B);
  assert.equal(r.meses, 0);
  assert.equal(r.A.mesmoPonto, null);
  assert.equal(r.B.atual, null);
  assert.equal(r.A.final.periodo, '2026-09');
});

test('com três meses de novo mandato, o anterior é lido no mês 3', () => {
  const r = compararMandatos(serieMensal('2022-01', '2027-03'), A, B);
  assert.equal(r.meses, 3);
  assert.equal(r.A.mesmoPonto.periodo, '2023-03');
  assert.equal(r.B.atual.periodo, '2027-03');
});

test('séries trimestrais usam o último trimestre disponível até o mesmo mês', () => {
  const tri = [['2022-12', 1], ['2023-03', 2], ['2023-06', 3], ['2026-12', 9], ['2027-03', 10], ['2027-06', 11]];
  const r = compararMandatos(tri, A, B);
  assert.equal(r.meses, 6);
  assert.equal(r.A.mesmoPonto.periodo, '2023-06');
  assert.equal(r.B.base.periodo, '2026-12');
});

test('mandatoEm respeita a posse em 5 de janeiro', () => {
  const ms = [A, B];
  assert.equal(mandatoEm('2027-01-04', ms).id, '2023-2026');
  assert.equal(mandatoEm('2027-01-05', ms).id, '2027-2030');
});

test('deflator usa a média do índice no período e o último índice disponível', () => {
  const indice = [['2025-01', 100], ['2025-02', 102], ['2026-01', 110]];
  const f = fatorDeflacao(indice, 2025, 2);
  assert.equal(f.referencia, '2026-01');
  assert.ok(Math.abs(f.fator - 110 / 101) < 1e-12);
  assert.equal(fatorDeflacao(indice, 2024, 12), null);
});

test('diferença em pontos percentuais para taxas e em % para valores', () => {
  assert.equal(diferenca(5.79, 4.58, '%', 2).texto, '−1,21 p.p.');
  assert.equal(diferenca(100, 110, 'R$', 0).texto, '+10,0%');
  assert.equal(diferenca(13.75, 13.75, '% a.a.', 2).direcao, 'igual');
});

test('rótulos de período em português', () => {
  assert.equal(rotuloPeriodo('2026-09', 'mensal'), 'set/2026');
  assert.equal(rotuloPeriodo('2026-06', 'trimestral'), '2º trimestre de 2026');
  assert.equal(rotuloPeriodo('2027-01', 'trimestre-movel'), 'nov/2026–jan/2027');
  assert.equal(rotuloPeriodo('2026-10-23', 'diaria'), '23/10/2026');
});

test('o dia de Brasília não vira antes da meia-noite local', () => {
  assert.equal(hojeBrasilia(new Date('2026-10-26T01:40:00Z')), '2026-10-25');
  assert.equal(hojeBrasilia(new Date('2026-10-26T03:00:00Z')), '2026-10-26');
});

test('cor da variação segue o sentido do indicador', () => {
  assert.deepEqual(
    [tendencia(4.22, 4.58, '%', 2, 'menor-melhor').tom, tendencia(5.4, 5.3, '%', 1, 'menor-melhor').tom],
    ['desfavoravel', 'favoravel'],
    'inflação em alta é vermelha; desemprego em queda é verde',
  );
  assert.equal(tendencia(1.8, 1.9, '%', 1, 'maior-melhor').tom, 'favoravel');
  assert.equal(tendencia(5.10, 5.04, 'R$', 4, 'neutro').tom, 'neutro');
  assert.equal(tendencia(2795, 2457, 'n', 1, 'menor-melhor').tom, 'favoravel', 'menos mortes é verde');
  assert.equal(tendencia(82.87, 82.89, '% do PIB', 1, 'menor-melhor').direcao, 'igual', 'mudança invisível no arredondamento não ganha seta');
});
