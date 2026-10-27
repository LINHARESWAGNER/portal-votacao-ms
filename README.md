# Votação MS

Mapa e rankings de votação por **local de votação** e **bairro** em Mato Grosso do Sul,
a partir do Portal de Dados Abertos do TSE.

| Conjunto | Recorte |
|---|---|
| Vereador 2020 e 2024 | Campo Grande |
| Deputado Federal 2022 e 2026 | MS inteiro |
| Deputado Estadual 2022 e 2026 | MS inteiro |

## O que o portal faz

- **Filtros no painel lateral**, com várias seleções ou "Todos": **Eleição**, **Município** e **Partido**;
  além de abrangência (Estado, Capital, Interior), agrupamento (Capital: Regiões urbanas / Bairros / Locais de votação;
  Estado e Interior: Regiões do estado / Cidades / Bairros) e busca de candidato.
  Com várias eleições, a lista de candidatos junta todas (com a eleição indicada) e a tabela mostra válidos e mais votado de cada uma.
- **Mapa** ocupando a tela, preso a Mato Grosso do Sul (o que fica fora do estado aparece escurecido), com botão **⌖ centralizar**.
  Regiões, municípios e bairros oficiais aparecem **pintados** pelo contorno; locais de votação e bairros sem contorno oficial, como bolhas.
  Ao agrupar por bairros (ou locais), a cidade aparece só com o **contorno tracejado**, sem preenchimento.
  Passe o mouse para ver os números; clique para abrir o ranking na tabela.
- **Tabela e gráfico de colunas** abaixo do mapa, com as mesmas linhas e a mesma ordem (votos ou % dos válidos).
- **Comparação de até 4 candidatos**, da mesma eleição ou de eleições diferentes. Colunas em **ordem cronológica**;
  a diferença (Δ) é **eleição mais recente − mais antiga**. A mesma pessoa é reconhecida entre eleições pelo nome completo.
- **Nomes dos candidatos:** o portal mostra o **nome de urna** do TSE (ex.: "Marquinhos Trad"). Em **⚙ Ajustes de nomes**
  dá para corrigir qualquer nome; o ajuste fica salvo no navegador e pode ser exportado como `docs/data/apelidos.json`
  para valer para todos que acessarem o site.
- **Regiões do estado:** as 10 regiões turísticas de MS (Pantanal, Costa Leste, Vale do Aporé, Caminho dos Ipês,
  Bonito/Serra da Bodoquena, Caminhos da Fronteira, Vale das Águas, Grande Dourados, 7 Caminhos da Natureza/Cone Sul
  e Rota Norte), pintadas no mapa. A lista município → região está em `pipeline/geo/regioes_ms.py`.
- **Campo Grande:** 7 regiões urbanas e 74 bairros oficiais; distritos e zona rural à parte.
- **Bairros oficiais do IBGE (Censo 2022):** nos 18 municípios de MS que têm bairros definidos em lei (Campo Grande,
  Naviraí, Três Lagoas, Nova Andradina, Corumbá, Ponta Porã, Angélica, Aquidauana, Bela Vista, Eldorado, Batayporã,
  Iguatemi, Ivinhema, São Gabriel do Oeste, Ladário, Antônio João, Bonito e Laguna Carapã), cada local de votação é
  classificado pela posição dentro do bairro oficial, os bairros são pintados no mapa e aparecem com a **população
  residente** do Censo 2022.
- **Demais bairros do interior** (ex.: Dourados): agrupados a partir do cadastro do TSE — numerações viram um bairro só
  (Jardim Flórida e Jardim Flórida II), cada distrito vira "Distrito de …", e zona rural, assentamentos e
  aldeias/reservas indígenas formam três grupos.
- O endereço da página guarda a análise (eleições, candidatos, recorte), então dá para compartilhar o link.

## Como funciona

```
data/raw/*.zip  ──►  pipeline/build.py  ──►  docs/data/<conjunto>/*.json  ──►  docs/ (site estático)
```

1. **Votação por seção** (`votacao_secao_<ano>_MS.zip`) traz votos por município, zona, seção e candidato.
2. **Eleitorado por local de votação** (`eleitorado_local_votacao_<ano>.zip`) liga cada seção ao
   local (escola), com endereço, **bairro** e **coordenadas**.
3. O pipeline cruza os dois por (município, zona, seção), padroniza os nomes de bairro
   (ex.: "JD. AMÉRICA" e "Jardim America" viram `JARDIM AMERICA`) e gera JSON pré-agregados.

O pipeline usa só a biblioteca padrão do Python (3.9+), sem dependências.

## Passo a passo

### 1. Baixar os dados do TSE

Salve os ZIPs em `data/raw/` (não precisa descompactar):

- https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_secao/votacao_secao_2020_MS.zip
- https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_secao/votacao_secao_2022_MS.zip
- https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_secao/votacao_secao_2024_MS.zip
- https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_secao/votacao_secao_2026_MS.zip
- https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_2020.zip
- https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_2022.zip
- https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_2024.zip
- https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip

Para o **nome de urna** dos candidatos, baixe também (opcional, mas recomendado):

- https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2020.zip
- https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2022.zip
- https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2024.zip
- https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2026.zip

Se algum link falhar, procure em https://dadosabertos.tse.jus.br pelos conjuntos
"Resultados <ano> → Votação por seção eleitoral" e "Eleitorado <ano> → Eleitorado por local de votação".

### 2. Gerar os dados do portal

```bash
python pipeline/build.py                 # todos os conjuntos disponíveis
python pipeline/build.py --only ver_2024 # só um
```

Conjuntos sem arquivo em `data/raw/` são pulados.

### 3. Ver o portal localmente

O navegador não carrega JSON via `file://`, então a pasta `docs/` precisa ser servida por um servidor local.
No Windows, dê dois cliques em **`servir.bat`** (abre o portal em http://localhost:8077). Ou, no terminal:

```bash
python -m http.server 8077 --directory docs
```

e abra http://localhost:8077. Se a 8077 também estiver ocupada, troque por outro número (ex.: 8090)
no comando e no endereço.

### 4. Publicar (GitHub Pages)

O site fica na pasta `docs/`, que o GitHub Pages publica direto, sem build.
No repositório: **Settings → Pages → Build and deployment → Source: Deploy from a branch →
Branch: `main` / pasta `/docs`**. Cada `git push` atualiza o site.

## Bairros oficiais (IBGE) e regiões de Campo Grande

`pipeline/geo/bairros_ibge.json` vem da **malha de bairros do Censo 2022** (`MS_bairros_CD2022.zip`) e da tabela
**População residente por bairros** do IBGE: diz em qual bairro oficial cai cada local de votação (pela coordenada;
locais a até ~300 m da divisa vão para o bairro mais próximo) e a população de cada bairro. Os contornos do mapa
estão em `docs/data/geo/ms_bairros.geojson`. Para atualizar, baixe os dois arquivos do IBGE em `data/raw`:

- https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/bairros/shp/UF/MS_bairros_CD2022.zip
- https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/tabelas_complementares/Populacao_residente_por_bairros_sexo_idade.xlsx

### Regiões de Campo Grande

`pipeline/geo/cg_regioes.json` diz a qual bairro oficial e região pertence cada local de votação da capital:

- **`coord`**: bairro oficial (IBGE) e região urbana de cada local, pela coordenada.
- **Regiões**: da planilha *ListaGlobalRegioes* (loteamento → bairro → região urbana).
- **`nome`**: reserva por nome de bairro/loteamento, usada quando surge um local novo sem coordenada conhecida.

Os contornos usados para pintar o mapa ficam em `docs/data/geo/`: `ms.geojson` (estado), `ms_municipios.geojson` (79 municípios, simplificados a ~1 km), `ms_regioes.geojson` (10 regiões do estado, união dos municípios), `ms_bairros.geojson` (296 bairros oficiais do IBGE) e `cg_regioes.geojson` (regiões urbanas de Campo Grande, união dos bairros do IBGE).

Se uma eleição futura trouxer locais novos, eles caem na reserva por nome; o que não casar aparece como "Não classificado".

## Estrutura dos dados gerados (`docs/data/<conjunto>/`)

| Arquivo | Conteúdo |
|---|---|
| `meta.json` | totais e indicadores de qualidade (locais sem coordenada, seções sem local) |
| `locais.json` | um array por local: id, nome, endereço, bairro, município, lat, lon, eleitores, seções, válidos, brancos, nulos, top 10 |
| `candidatos.json` | `[número, nome civil, nº partido, votos, nome de urna]`, ordenado por votos |
| `partidos.json` | `[número, sigla, votos nominais + legenda]` |
| `bairros.json` | por bairro: índices dos locais, votos válidos, eleitores, top 20 |
| `cg_grupos.json` | bairros agrupados de todos os municípios (com população do IBGE quando houver) e regiões urbanas de Campo Grande (top 20 de cada) |
| `municipios.json` | ranking completo de candidatos por município |
| `cand/<número>.json` | `[índice do local, votos]` de um candidato |

## Limitações

- **Bairro = onde fica o local de votação**, não onde o eleitor mora.
- O bairro vem digitado no cadastro do TSE. A padronização resolve abreviações comuns,
  mas grafias muito diferentes podem continuar separadas. Ajuste a lista `ABREV`
  em `pipeline/build.py` se encontrar casos.
- Locais sem latitude/longitude no cadastro não aparecem no mapa, mas entram nas tabelas.
- Considera apenas o 1º turno e eleições ordinárias.
