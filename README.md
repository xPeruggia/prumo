# Prumo — o Brasil medido todos os dias

Observatório independente de dados públicos do Brasil. Um site estático que mostra, todos os dias,
os principais indicadores do país a partir das fontes oficiais, com a conferência de cada número
à vista do leitor.

O que o site acompanha:

- **Indicadores do dia**: inflação (IPCA), Selic, dólar, PIB, desemprego, rendimento, dívida bruta e líquida, resultado primário e expectativas do mercado (Focus).
- **Contas públicas**: arrecadação de impostos e contribuições da União (com contador estimado em tempo real), dívida pública e resultado primário desde 2015.
- **Gastos por área**: despesa da União em cada função (saúde, educação, assistência social, segurança etc.) e investimentos, ano a ano, corrigidos pela inflação.
- **Programas criados pelo Executivo**: medidas provisórias e projetos de lei da Presidência que instituem programas, detectados automaticamente, com a situação de cada um.
- **Segurança e violência**: mortes violentas intencionais, homicídios, feminicídios, latrocínios, estupros, roubos e furtos de veículos e de carga, mortes por intervenção policial (Sinesp, 2015 em diante, por estado), e denúncias de LGBTfobia (homofobia e transfobia) e de intolerância religiosa com filtro por religião da vítima (Disque 100, jul/2020 em diante). Comparação mês a mês com os anos anteriores e por mandato.
- **Comparativo entre mandatos**: o mandato 2023–2026 contra o mandato 2027–2030 (posse em 5/1/2027), sempre no mesmo mês de governo; para crimes e denúncias, a soma dos mesmos meses de cada mandato desde 2015.
- **Notícias de fontes oficiais**: comunicados do IBGE e do Banco Central, com filtro de conteúdo político-partidário e conferência dos números citados.

## Como a verificação funciona

| Selo | Significado |
|---|---|
| Confere com segunda fonte | O número foi encontrado em outra fonte oficial independente (ex.: IPCA no IBGE e no Banco Central) ou recalculado a partir dos componentes (ex.: dívida em reais ÷ PIB). |
| Fonte única oficial | Só o órgão que produz o dado o publica. O link para o original acompanha o número. |
| Estimativa calculada | Número calculado pelo site (o contador de arrecadação). A fórmula aparece ao lado. |
| Segunda fonte indisponível hoje | A segunda fonte não respondeu; a conferência é refeita na próxima coleta. |
| Divergência entre fontes | As fontes publicam valores diferentes para o mesmo período. |
| Falha na coleta | A fonte falhou ou devolveu valor implausível. O site mantém o último dado válido e avisa. |

Além disso:

- **Teste de plausibilidade**: cada série tem uma faixa de valores possíveis (`config/series.json`). Um valor fora dela é rejeitado.
- **Conferência pelo leitor**: o botão “Conferir” refaz a consulta nas APIs do Banco Central e do IBGE diretamente do navegador de quem lê, sem passar pelo site.
- **Filtro político**: notícias com os termos de `config/filtro-politico.json` são retiradas e listadas publicamente, com o termo encontrado.
- **Números em notícias**: quando um título cita IPCA, desemprego, PIB ou Selic, o número é comparado com a série oficial. O site nunca rotula uma notícia como “falsa”; diz apenas se o número bate.
- **Cores das variações**: cada número mostra a variação sobre o período anterior com seta (▲▼) e cor. Verde quando a mudança vai no sentido geralmente considerado favorável e vermelho no contrário, definido por indicador no campo `sentido` de `config/series.json` (inflação, desemprego e dívida: verde ao cair; PIB, renda e resultado primário: verde ao subir; Selic, dólar e dívida em reais: sem cor). Em segurança e violência, queda é verde e alta é vermelha (`config/seguranca.json`).
- **Histórico**: cada coleta vira um commit em `data/`. Qualquer alteração de valor fica registrada no git e no diário de atualizações do site.

## Fontes

| Órgão | O que vem de lá | Serviço |
|---|---|---|
| IBGE | IPCA, PIB, desemprego, rendimento, população, notícias | [SIDRA](https://apisidra.ibge.gov.br/), [API de notícias](https://servicodados.ibge.gov.br/api/docs/noticias) |
| Banco Central | Selic, dólar, dívida, resultado primário, Focus, notas à imprensa | [SGS](https://dadosabertos.bcb.gov.br/), PTAX e Expectativas (Olinda) |
| Tesouro Nacional | Receitas e despesas da União por área | [SICONFI – RREO](https://apidatalake.tesouro.gov.br/docs/siconfi/) |
| Câmara dos Deputados | Medidas provisórias e projetos do Executivo | [Dados Abertos da Câmara](https://dadosabertos.camara.leg.br/swagger/api.html) |
| Ministério da Justiça | Crimes e vítimas por estado e mês | [Sinesp VDE](https://www.gov.br/mj/pt-br/assuntos/sua-seguranca/seguranca-publica/estatistica/dados-nacionais-1/base-de-dados-e-notas-metodologicas-dos-gestores-estaduais-sinesp-vde-2022-e-2023) |
| Ministério dos Direitos Humanos | Denúncias de LGBTfobia e intolerância religiosa | [Disque 100](https://www.gov.br/mdh/pt-br/acesso-a-informacao/dados-abertos/disque100) |

Nenhuma chave de API é necessária.

## Rodar no computador

Requer Node.js 20 ou mais recente. Não há dependências para instalar.

```bash
npm run atualizar
```

```bash
npm run servir
```

Depois abra `http://localhost:8080`. O site precisa ser servido por HTTP (abrir o `index.html` direto do disco não carrega os dados).

Para coletar só uma parte: `node scripts/atualizar.mjs series noticias` (partes: `series`, `orcamento`, `programas`, `noticias`).

Para rodar os testes das regras de comparação e verificação:

```bash
npm run testar
```

## Publicar com atualização automática (GitHub Pages)

1. Crie um repositório no GitHub e envie esta pasta.
2. Em **Settings → Pages**, escolha **Source: GitHub Actions**.
3. Em **Settings → Actions → General → Workflow permissions**, marque **Read and write permissions**.
4. Rode o workflow **Atualizar dados** uma vez pela aba **Actions** (botão *Run workflow*).

A partir daí a coleta roda sozinha três vezes por dia (6h, 10h e 19h de Brasília), registra o que mudou e publica o site. Se nenhum dado mudou, nada é commitado.

Os microdados do Disque 100 têm de 1 a 2 GB por arquivo. Eles ficam fora da coleta diária: o fluxo **Atualizar Disque 100** roda às segundas-feiras, só baixa arquivos novos ou alterados (pela etiqueta do servidor), guarda os totais mensais em `data/cache/disque100/` e dispara a coleta diária para publicar. As planilhas do Sinesp entram na coleta diária, mas só os dois anos mais recentes são baixados de novo; os anteriores ficam em `data/cache/sinesp/`. Para reprocessar tudo: `node scripts/seguranca.mjs sinesp --todos`.

## Configuração

- `config/site.json`: nome, descrição, responsável, contato e link do repositório (aparecem no rodapé). Preencha `contato` e `repositorio` antes de publicar.
- `config/mandatos.json`: datas dos mandatos e quais dois são comparados.
- `config/series.json`: indicadores, fontes, segunda fonte de conferência e faixa plausível.
- `config/filtro-politico.json`: termos que retiram uma notícia do feed.
- `config/programas.json`: regras do detector de programas e o campo `revisoes`, onde um editor corrige a classificação “social” de uma proposição:

```json
"revisoes": {
  "2620929": { "social": true, "nota": "Renegociação de dívidas de famílias de baixa renda" }
}
```

## Limitações conhecidas

- O orçamento cobre a União. Estados e municípios não estão incluídos; o contador de arrecadação é federal.
- O detector de programas lê só medidas provisórias e projetos de lei do Executivo. Programas criados por decreto ou por iniciativa do Congresso ficam de fora, e a classificação “social” é por palavras-chave.
- O número de beneficiários de programas como o Bolsa Família não tem API pública aberta (o portal do MDS exige login e o Portal da Transparência exige chave e consulta município por município), por isso não é coletado.
- O layout do RREO no SICONFI muda antes de 2018; o orçamento começa em 2019, cobrindo integralmente os mandatos 2019–2022 e 2023–2026.
- Em 2022, o anexo 2 do RREO incluiu o refinanciamento da dívida; o site retira esse valor para manter a comparação e mostra o ajuste.
- O Sinesp só padroniza nacionalmente roubos e furtos de veículos, de carga e a instituições financeiras. Roubos e furtos de celulares e a pessoas não têm série nacional mensal oficial.
- Homofobia, transfobia e intolerância religiosa não têm estatística policial nacional; o site usa denúncias ao Disque 100, que medem o que chega ao canal. A identificação de pessoas trans só aparece nos microdados a partir de jul/2022, e a religião da vítima deixou de ser informada em cerca de três de cada quatro denúncias de intolerância religiosa em 2023 e 2024 (em 2020–2022 o campo era preenchido na maioria dos casos).
- O arquivo do Disque 100 do 1º semestre de 2020 usa outro formato e não foi incluído; a série começa em jul/2020.
- O servidor de notícias do IBGE (`servicodados.ibge.gov.br`) recusa conexões vindas de fora do Brasil, e o GitHub Actions roda no exterior. Quando a coleta falha, o arquivo `data/noticias.json` registra a falha e mantém as notícias anteriores; o navegador do leitor então busca as notícias do IBGE direto na API (que aceita acesso de navegadores) e aplica o mesmo filtro e a mesma conferência, com o mesmo código (`scripts/lib/verificacao.mjs`). O site avisa quando isso acontece. O site da Agência de Notícias do IBGE fica atrás de uma verificação anti-robô e não é usado.
- A Lei 14.994/2024 tornou o feminicídio crime autônomo. Testamos nos dados se o Sinesp somava feminicídios ao homicídio doloso antes disso e não encontramos queda nas vítimas mulheres de homicídio a partir de out/2024; por isso as duas naturezas são somadas em todo o período, sem ajuste.

## Estrutura

```
index.html                 página única
assets/css/prumo.css       identidade visual (claro e escuro)
assets/js/nucleo.js        regras puras: períodos, mandatos, deflação (usadas no site e na coleta)
assets/js/graficos.js      gráficos em SVG, sem bibliotecas
assets/js/conferir.js      conferência feita no navegador do leitor e o carimbo
assets/js/dom.js           utilidades de interface compartilhadas
assets/js/seguranca.js     seção de segurança e violência
assets/js/app.js           monta as demais seções a partir de data/
scripts/atualizar.mjs      coleta diária
scripts/seguranca.mjs      Sinesp e Disque 100 (lidos em fluxo, só os totais são guardados)
scripts/lib/               clientes das APIs, leitores de .xlsx e CSV e regras de verificação
scripts/testes/            testes automatizados
data/                      gerado pela coleta (não editar à mão)
data/cache/                totais mensais por arquivo de origem (Sinesp por ano, Disque 100 por semestre)
.github/workflows/         coleta diária e coleta semanal do Disque 100
```
