// Testes da imprensa lado a lado: leitura dos feeds, marcação de colunas e agrupamento do mesmo fato.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodificarFeed, lerData, lerRss, trecho, tipoDeTexto, agruparMesmoFato, compararTitulos } from '../imprensa.mjs';

const config = JSON.parse(readFileSync(new URL('../../config/imprensa.json', import.meta.url), 'utf8'));
const latin1 = (s) => Buffer.from(s, 'latin1');

test('feed em Latin-1 é lido com acentos, declarado ou não', () => {
  assert.equal(decodificarFeed(latin1('<?xml version="1.0" encoding="ISO-8859-1"?><t>Flávio</t>')), '<?xml version="1.0" encoding="ISO-8859-1"?><t>Flávio</t>');
  assert.equal(decodificarFeed(latin1('<rss><t>reeleição</t></rss>')), '<rss><t>reeleição</t></rss>');
  assert.equal(decodificarFeed(Buffer.from('<rss><t>inflação</t></rss>', 'utf8')), '<rss><t>inflação</t></rss>');
});

test('datas em inglês e em português viram o mesmo instante', () => {
  assert.equal(lerData('Tue, 27 Oct 2026 16:22:47 +0000'), '2026-10-27T16:22:47.000Z');
  assert.equal(lerData('Ter, 27 Out 2026 13:22:47 -0300'), '2026-10-27T16:22:47.000Z');
  assert.equal(lerData('27 Oct 2026 13:22:47 -0300'), '2026-10-27T16:22:47.000Z');
  assert.equal(lerData('sem data'), null);
});

test('item de RSS: CDATA, entidades, tags e o link real por trás do redirecionador', () => {
  const [it] = lerRss(`<rss><channel><item>
    <title><![CDATA[Governo prorroga subvenção ao diesel]]></title>
    <link>https://redir.folha.com.br/redir/online/emcimadahora/rss091/*https://www1.folha.uol.com.br/mercado/2026/10/diesel.shtml</link>
    <description>Medida vale por &lt;a href=&quot;x&quot;&gt;mais 30 dias&lt;/a&gt; &amp; custa R$ 2,12. Leia mais (10/27/2026 - 17h49)</description>
    <category>Economia</category>
    <pubDate>27 Oct 2026 17:49:00 -0300</pubDate>
  </item></channel></rss>`);
  assert.equal(it.titulo, 'Governo prorroga subvenção ao diesel');
  assert.equal(it.link, 'https://www1.folha.uol.com.br/mercado/2026/10/diesel.shtml');
  assert.equal(it.resumo, 'Medida vale por mais 30 dias & custa R$ 2,12.');
  assert.deepEqual(it.categorias, ['Economia']);
  assert.equal(it.publicadoEm, '2026-10-27T20:49:00.000Z');
});

test('o resumo perde as chamadas do feed e os espaços soltos antes da pontuação', () => {
  const [it] = lerRss(`<rss><item><title>T</title><link>https://x.example/a</link>
    <description><![CDATA[<p>O presidente do <a href="#">Senado</a> , Davi Alcolumbre ( <b>União Brasil</b> -AP), falou. Leia na Gazeta do Povo.</p>]]></description>
    <pubDate>Tue, 27 Oct 2026 16:22:47 +0000</pubDate></item></rss>`);
  assert.equal(it.resumo, 'O presidente do Senado, Davi Alcolumbre (União Brasil -AP), falou.');
});

test('o trecho é curto e termina numa palavra inteira', () => {
  const longo = 'palavra '.repeat(60).trim();
  const t = trecho(longo, 50);
  assert.ok(t.length <= 51);
  assert.ok(t.endsWith('palavra…'));
  assert.equal(trecho('curto', 50), 'curto');
});

test('coluna e análise seguem a marcação do próprio veículo', () => {
  const tipo = (link, categorias = [], titulo = 'Título') => tipoDeTexto({ link, categorias, titulo }, config.marcacao);
  assert.equal(tipo('https://www1.folha.uol.com.br/colunas/painel/2026/10/x.shtml'), 'coluna');
  assert.equal(tipo('https://g1.globo.com/politica/blog/andreia-sadi/post/2026/10/27/x.ghtml'), 'coluna');
  assert.equal(tipo('https://www.cnnbrasil.com.br/politica/x/', ['Análise']), 'analise');
  assert.equal(tipo('https://www.estadao.com.br/economia/x/', [], 'Opinião: o que muda'), 'coluna');
  assert.equal(tipo('https://agenciabrasil.ebc.com.br/economia/noticia/2026-10/x'), 'noticia');
});

const materia = (veiculo, titulo, resumo = '') => ({ veiculo, titulo, resumo, link: `https://${veiculo}.example/${titulo.length}`, publicadoEm: '2026-10-27T12:00:00.000Z' });

// Um dia de feed tem centenas de assuntos; estas manchetes avulsas fazem o papel do resto do noticiário.
const avulsas = [
  'Seleção brasileira vence amistoso contra o Japão', 'Chuvas fortes atingem o litoral de Santa Catarina',
  'Prefeitura anuncia novo horário de ônibus na capital', 'Festival de cinema divulga filmes da mostra competitiva',
  'Vacinação contra gripe é ampliada para adolescentes', 'Incêndio atinge galpão na zona norte',
  'Universidade abre inscrições para mestrado', 'Museu reabre após reforma de dois anos',
  'Preço do café sobe no mercado internacional', 'Time paulista contrata técnico argentino',
  'Pesquisa mostra aumento de leitores de livros digitais', 'Ponte é interditada após rachaduras',
].map((titulo, k) => materia(['folha', 'cnn', 'veja', 'uol', 'bbc', 'poder360'][k % 6], titulo));

test('matérias sobre o mesmo fato em veículos diferentes formam um grupo', () => {
  const itens = [
    materia('g1', 'Governo prorroga subvenção ao diesel por mais 30 dias'),
    materia('estadao', 'Governo vai renovar subvenção de R$ 2,12 por litro do diesel por um mês'),
    materia('agenciabrasil', 'Governo prorroga por um mês subvenção de R$ 2,12 ao diesel'),
    ...avulsas,
  ];
  const grupos = agruparMesmoFato(itens, { limiar: config.limiar }).filter((g) => g.length >= 3);
  assert.equal(grupos.length, 1);
  assert.deepEqual(grupos[0].map((m) => m.veiculo).sort(), ['agenciabrasil', 'estadao', 'g1']);
});

test('um grupo nunca tem duas matérias do mesmo veículo', () => {
  const itens = [
    materia('g1', 'Banco Central mantém Selic em 13,75% ao ano'),
    materia('g1', 'Copom mantém Selic em 13,75% ao ano pela terceira vez'),
    materia('folha', 'Banco Central mantém Selic em 13,75%'),
    materia('cnn', 'Copom mantém taxa Selic em 13,75% ao ano'),
    ...avulsas,
  ];
  for (const g of agruparMesmoFato(itens, { limiar: config.limiar })) {
    assert.equal(new Set(g.map((m) => m.veiculo)).size, g.length);
  }
});

test('títulos comparados: palavras em comum e as que só um veículo usou', () => {
  const grupo = [
    materia('g1', 'Governo prorroga subvenção ao diesel'),
    materia('estadao', 'Governo renova subvenção ao diesel'),
    materia('agenciabrasil', 'Governo prorroga subvenção ao diesel importado'),
  ];
  const { comuns, marcados } = compararTitulos(grupo);
  assert.ok(comuns.includes('Governo') && comuns.includes('diesel'));
  const destacadas = (k) => marcados[k].filter(([, exclusivo]) => exclusivo).map(([t]) => t.trim());
  assert.deepEqual(destacadas(1), ['renova']);
  assert.deepEqual(destacadas(2), ['importado']);
  assert.equal(marcados[0].map(([t]) => t).join(''), grupo[0].titulo);
});
