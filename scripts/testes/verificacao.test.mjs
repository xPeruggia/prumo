import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cruzar, toleranciaPadrao, testarPlausibilidade, montarFiltro, conferirNumero } from '../lib/verificacao.mjs';

const filtro = montarFiltro(JSON.parse(await readFile(new URL('../../config/filtro-politico.json', import.meta.url), 'utf8')));

test('cruzamento confere quando as fontes concordam e aponta a defasagem', () => {
  const r = cruzar([['2026-08', 4.22], ['2026-09', 4.58]], [['2026-08', 4.22]], toleranciaPadrao(2));
  assert.equal(r.status, 'confere');
  assert.equal(r.periodo, '2026-08');
  assert.match(r.defasagem, /2026-09/);
});

test('cruzamento acusa divergência no último período comum', () => {
  const r = cruzar([['2026-09', 4.58]], [['2026-09', 4.6]], toleranciaPadrao(2));
  assert.equal(r.status, 'diverge');
  assert.equal(r.diferenca, -0.02);
});

test('plausibilidade rejeita valores fora da faixa e datas futuras', () => {
  assert.match(testarPlausibilidade([['2026-09', 400]], [-5, 60], '2026-10-25'), /fora da faixa/);
  assert.match(testarPlausibilidade([['2026-11', 4]], [-5, 60], '2026-10-25'), /futuro/);
  assert.equal(testarPlausibilidade([['2026-08', 4], ['2026-09', 4.5]], [-5, 60], '2026-10-25'), null);
});

test('filtro político pega termos e siglas, sem falsos positivos óbvios', () => {
  assert.ok(filtro('Pesquisa eleitoral mostra empate'));
  assert.equal(filtro('Deputados do PT e do PL discutem'), 'PT');
  assert.equal(filtro('Eleições municipais'), 'eleições');
  assert.equal(filtro('IPCA fica em 0,82% em setembro'), null);
  assert.equal(filtro('Ptax e placas de petróleo'), null);
  assert.equal(filtro('O IBGE apresenta o PIB do trimestre'), null);
});

const series = {
  ipcaMes: { pontos: [['2026-09', 0.82]] },
  ipca12m: { pontos: [['2026-09', 4.58]] },
  desemprego: { pontos: [['2026-08', 5.3]] },
  pibTri: { pontos: [['2026-06', 0.5]] },
  pib4tri: { pontos: [['2026-06', 1.9]] },
  selic: { ultimosDiarios: [['2026-09-17', 13.75]] },
};

test('número de notícia do IPCA confere com a série', () => {
  const r = conferirNumero({ titulo: 'IPCA fica em 0,82% em setembro', resumo: '', publicadoEm: '2026-10-09T09:00:00-03:00' }, series);
  assert.equal(r.ok, true);
  assert.equal(r.serie, 'ipcaMes');
});

test('número que não bate é sinalizado sem ser chamado de falso', () => {
  const r = conferirNumero({ titulo: 'IPCA fica em 0,91% em setembro', resumo: '', publicadoEm: '2026-10-09T09:00:00-03:00' }, series);
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.nota, /fals/i);
});

test('IPCA-15 e notícias sem número não são conferidos', () => {
  assert.equal(conferirNumero({ titulo: 'O IPCA-15 é de 0,32% em outubro', resumo: '', publicadoEm: '2026-10-23T09:00:00-03:00' }, series), null);
  assert.equal(conferirNumero({ titulo: 'IBGE visita Xangai', resumo: '', publicadoEm: '2026-10-19T09:00:00-03:00' }, series), null);
});

test('PIB do trimestre e desocupação são conferidos', () => {
  assert.equal(conferirNumero({ titulo: 'PIB cresce 0,5% no segundo trimestre', resumo: '', publicadoEm: '2026-09-02T09:00:00-03:00' }, series).ok, true);
  assert.equal(conferirNumero({ titulo: 'Taxa de desocupação fica em 5,3% no trimestre encerrado em agosto', resumo: '', publicadoEm: '2026-09-30T09:00:00-03:00' }, series).ok, true);
});

test('Selic citada em nota do Copom é comparada com a meta da semana', () => {
  assert.equal(conferirNumero({ titulo: 'Copom mantém a taxa Selic em 13,75% a.a.', resumo: '', publicadoEm: '2026-09-16T18:30:00-03:00' }, series).ok, true);
});
