# Portal de Votação MS por Bairro

Mapa e rankings de votação por **local de votação** e **bairro** em Mato Grosso do Sul,
a partir do Portal de Dados Abertos do TSE.

| Conjunto | Recorte |
|---|---|
| Vereador 2020 e 2024 | Campo Grande |
| Deputado Federal 2022 e 2026 | MS inteiro |
| Deputado Estadual 2022 e 2026 | MS inteiro |

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

O navegador não carrega JSON via `file://`, então sirva a pasta `docs/`:

```bash
cd docs
python -m http.server 8000
```

Abra http://localhost:8000.

### 4. Publicar (GitHub Pages)

O site fica na pasta `docs/`, que o GitHub Pages publica direto, sem build.
No repositório: **Settings → Pages → Build and deployment → Source: Deploy from a branch →
Branch: `main` / pasta `/docs`**. Cada `git push` atualiza o site.

## Estrutura dos dados gerados (`docs/data/<conjunto>/`)

| Arquivo | Conteúdo |
|---|---|
| `meta.json` | totais e indicadores de qualidade (locais sem coordenada, seções sem local) |
| `locais.json` | um array por local: id, nome, endereço, bairro, município, lat, lon, eleitores, seções, válidos, brancos, nulos, top 10 |
| `candidatos.json` | `[número, nome, nº partido, votos]`, ordenado por votos |
| `partidos.json` | `[número, sigla, votos nominais + legenda]` |
| `bairros.json` | por bairro: índices dos locais, votos válidos, eleitores, top 20 |
| `municipios.json` | ranking completo de candidatos por município |
| `cand/<número>.json` | `[índice do local, votos]` de um candidato |

## Limitações

- **Bairro = onde fica o local de votação**, não onde o eleitor mora.
- O bairro vem digitado no cadastro do TSE. A padronização resolve abreviações comuns,
  mas grafias muito diferentes podem continuar separadas. Ajuste a lista `ABREV`
  em `pipeline/build.py` se encontrar casos.
- Locais sem latitude/longitude no cadastro não aparecem no mapa, mas entram nas tabelas.
- Considera apenas o 1º turno e eleições ordinárias.
