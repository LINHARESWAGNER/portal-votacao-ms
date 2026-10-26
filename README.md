# Portal de Votação MS por Bairro

Mapa e rankings de votação por **local de votação** e **bairro** em Mato Grosso do Sul,
a partir do Portal de Dados Abertos do TSE.

| Conjunto | Recorte |
|---|---|
| Vereador 2020 e 2024 | Campo Grande |
| Deputado Federal 2022 e 2026 | MS inteiro |
| Deputado Estadual 2022 e 2026 | MS inteiro |

## O que o portal faz

- **Mapa** dos locais de votação, com o **resumo embaixo** por bairro ou cidade.
- **Abrangência:** Estado, Capital (Campo Grande) ou Interior; no Estado e no Interior dá para ver por **bairros** ou só por **cidades**.
- **Comparação de até 4 candidatos**, da mesma eleição ou de eleições diferentes
  (ex.: vereador 2020 × vereador 2024, ou vereador 2024 × deputado estadual 2026).
  A mesma pessoa é reconhecida entre eleições pelo nome completo; os locais são casados pela coordenada
  e os bairros pelo nome padronizado. No mapa, cada local fica com a cor de quem teve a maior % dos votos válidos ali.
- **Campo Grande por região:** na Capital, o resumo mostra as **7 regiões urbanas** (Anhanduizinho, Bandeira,
  Centro, Imbirussu, Lagoa, Prosa, Segredo), os **bairros oficiais** ou os **bairros como estão no cadastro do TSE**.
  Distritos (Anhanduí, Rochedinho, Bom Fim) e zona rural aparecem à parte.
- O endereço da página guarda a análise (eleição, candidatos, recorte), então dá para compartilhar o link.

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

## Regiões e bairros oficiais de Campo Grande

`pipeline/geo/cg_regioes.json` diz a qual bairro oficial e região pertence cada local de votação da capital:

- **`coord`**: classificação pela coordenada do local, feita com os limites de bairros do
  [OpenStreetMap](https://www.openstreetmap.org/user/ivaldonm/diary/36824) (dados © contribuidores OSM, licença ODbL).
- **Regiões**: da planilha *ListaGlobalRegioes* (loteamento → bairro → região urbana).
- **`nome`**: reserva por nome de bairro/loteamento, usada quando surge um local novo sem coordenada conhecida.

Se uma eleição futura trouxer locais novos, eles caem na reserva por nome; o que não casar aparece como "Não classificado".

## Estrutura dos dados gerados (`docs/data/<conjunto>/`)

| Arquivo | Conteúdo |
|---|---|
| `meta.json` | totais e indicadores de qualidade (locais sem coordenada, seções sem local) |
| `locais.json` | um array por local: id, nome, endereço, bairro, município, lat, lon, eleitores, seções, válidos, brancos, nulos, top 10 |
| `candidatos.json` | `[número, nome, nº partido, votos]`, ordenado por votos |
| `partidos.json` | `[número, sigla, votos nominais + legenda]` |
| `bairros.json` | por bairro: índices dos locais, votos válidos, eleitores, top 20 |
| `cg_grupos.json` | Campo Grande por bairro oficial e por região urbana (top 20 de cada) |
| `municipios.json` | ranking completo de candidatos por município |
| `cand/<número>.json` | `[índice do local, votos]` de um candidato |

## Limitações

- **Bairro = onde fica o local de votação**, não onde o eleitor mora.
- O bairro vem digitado no cadastro do TSE. A padronização resolve abreviações comuns,
  mas grafias muito diferentes podem continuar separadas. Ajuste a lista `ABREV`
  em `pipeline/build.py` se encontrar casos.
- Locais sem latitude/longitude no cadastro não aparecem no mapa, mas entram nas tabelas.
- Considera apenas o 1º turno e eleições ordinárias.
