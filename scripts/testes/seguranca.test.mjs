import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { somaNoMandato, acumuladoNoMandato, paresMensais, periodoDeIndice, indiceMes } from '../../assets/js/nucleo.js';
import { criarLeitorCsv } from '../lib/csv.mjs';
import { mesDeDataExcel } from '../lib/xlsx.mjs';
import { agregadorDisque100 } from '../seguranca.mjs';

const A = { id: '2019-2022', inicio: '2019-01-01', fim: '2023-01-01' };
const B = { id: '2023-2026', inicio: '2023-01-01', fim: '2027-01-05' };

const mensal = (de, ate, f = () => 1) => {
  const p = [];
  for (let i = indiceMes(de); i <= indiceMes(ate); i++) p.push([periodoDeIndice(i), f(i)]);
  return p;
};

test('soma no mandato usa os mesmos n meses de cada mandato', () => {
  const pontos = mensal('2019-01', '2026-09');
  assert.equal(somaNoMandato(pontos, A, 45), 45);
  assert.equal(somaNoMandato(pontos, B, 45), 45);
  assert.equal(somaNoMandato(pontos, B, 46), null, 'mês 46 de 2023–2026 ainda não existe');
});

test('soma no mandato recusa período com mês faltando', () => {
  const pontos = mensal('2019-01', '2022-12').filter(([m]) => m !== '2020-05');
  assert.equal(somaNoMandato(pontos, A, 12), 12);
  assert.equal(somaNoMandato(pontos, A, 24), null);
});

test('acumulado para no primeiro mês ausente', () => {
  const pontos = mensal('2023-01', '2023-06', () => 2).filter(([m]) => m !== '2023-04');
  assert.deepEqual(acumuladoNoMandato(pontos, B), [[1, 2], [2, 4], [3, 6]]);
});

test('pares mensais ignoram lacunas', () => {
  assert.deepEqual(paresMensais(['2026-01', '2026-02', '2026-03'], [5, null, 7]), [['2026-01', 5], ['2026-03', 7]]);
});

test('datas do Excel viram mês', () => {
  assert.equal(mesDeDataExcel(46023), '2026-01');
  assert.equal(mesDeDataExcel(46235), '2026-08');
  assert.equal(mesDeDataExcel('2026-07-01'), '2026-07');
  assert.equal(mesDeDataExcel('15/03/2021'), '2021-03');
});

test('leitor de CSV lida com aspas, separador dentro de aspas e quebra de pedaço', () => {
  const registros = [];
  const leitor = criarLeitorCsv((r) => registros.push(r));
  const texto = '﻿a;b;c\r\n1;"x;y";"dizer ""oi"""\r\n2;;fim\n';
  for (let i = 0; i < texto.length; i += 3) leitor.escrever(texto.slice(i, i + 3));
  leitor.terminar();
  assert.deepEqual(registros, [['a', 'b', 'c'], ['1', 'x;y', 'dizer "oi"'], ['2', '', 'fim']]);
});

test('denúncias do Disque 100 são contadas uma vez por denúncia e classificadas', async () => {
  const config = JSON.parse(await readFile(new URL('../../config/seguranca.json', import.meta.url), 'utf8')).disque100;
  const cab = Array.from({ length: 62 }, (_, i) => `c${i}`);
  Object.assign(cab, { 0: 'hash', 1: 'Data_de_cadastro', 7: 'UF', 12: 'Grupo_vulnerável', 16: 'Gênero_da_vítima', 17: 'Orientação_sexual_da_vítima', 32: 'Religião_da_vítima', 61: 'violacao' });
  const linha = (hash, data, uf, grupo, genero, orient, relig, viol) => {
    const c = Array(62).fill('NULL');
    Object.assign(c, { 0: hash, 1: data, 7: uf, 12: grupo, 16: genero, 17: orient, 32: relig, 61: viol });
    return c.join(';');
  };
  const csv = [
    cab.join(';'),
    linha('AAA1', '2026-07-03 10:00', 'SP', 'VIOLÊNCIA CONTRA POPULAÇÃO LGBTQIA+', 'MASCULINO', 'HOMOSSEXUAL.GAY', 'NULL', 'INTEGRIDADE>FÍSICA'),
    linha('AAA1', '2026-07-03 10:00', 'SP', 'VIOLÊNCIA CONTRA POPULAÇÃO LGBTQIA+', 'MASCULINO', 'HOMOSSEXUAL.GAY', 'NULL', 'INTEGRIDADE>PSÍQUICA'),
    linha('BBB2', '2026-07-09 10:00', 'RJ', 'VIOLÊNCIA CONTRA POPULAÇÃO LGBTQIA+', 'FEMININO', 'PESSOA TRANS.TRAVESTI', 'NULL', 'IGUALDADE>DISCRIMINAÇÃO'),
    linha('CCC3', '2026-08-01 10:00', 'BA', 'VIOLÊNCIA CONTRA CIDADÃO, FAMÍLIA OU COMUNIDADE', 'FEMININO', 'NÃO', 'CANDOMBLÉ', 'LIBERDADE>DE RELIGIÃO ou CRENÇA>DE CULTO'),
    linha('DDD4', '2026-08-02 10:00', 'BA', 'VIOLÊNCIA CONTRA CIDADÃO, FAMÍLIA OU COMUNIDADE', 'MASCULINO', 'NÃO', 'EVANGÉLICA', 'IGUALDADE>RACISMO>RELIGIOSO'),
    linha('EEE5', '2026-06-30 10:00', 'BA', 'VIOLÊNCIA CONTRA POPULAÇÃO LGBTQIA+', 'MASCULINO', 'BISSEXUAL', 'NULL', 'X'),
  ].join('\n') + '\n';
  const ag = agregadorDisque100({ inicio: '2026-07', fim: '2026-09' }, config);
  ag.escrever(csv);
  const r = ag.resultado();
  assert.equal(r.foraDoPeriodo, 1, 'junho fica fora do trimestre jul–set');
  assert.equal(r.temCodigoTrans, true);
  assert.deepEqual(
    { lgbt: r.meses['2026-07'].lgbt, homofobia: r.meses['2026-07'].homofobia, transfobia: r.meses['2026-07'].transfobia },
    { lgbt: 2, homofobia: 1, transfobia: 1 },
  );
  assert.equal(r.meses['2026-08'].religiosa, 2);
  assert.equal(r.meses['2026-08'].porReligiao.matrizAfricana, 1);
  assert.equal(r.meses['2026-08'].porReligiao.evangelica, 1);
  assert.equal(r.meses['2026-08'].religiosaUf.BA, 2);
});
