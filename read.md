# Fyah Headshop - Website

Site estático (HTML + CSS + JS puro, sem build, sem framework). Agenda semanal alimentada por uma planilha do Google publicada como CSV.

## Estrutura

```
index.html      → marcação da página
css/style.css   → todo o visual
js/agenda.js    → busca e renderiza a agenda a partir da planilha
```

## Configurar a agenda dinâmica

1. Crie uma planilha do Google com as colunas (nessa ordem, na primeira linha):

   | dow | day | title | details | time |
   |-----|-----|-------|---------|------|
   | SEX | 25  | Infesta: Baratinha | Do pop ao techno — line-up | A partir das 20h |

2. No Sheets: **Arquivo → Compartilhar → Publicar na web** → escolha a aba certa → formato **CSV** → **Publicar**.
3. Copie o link gerado.
4. Abra `js/agenda.js` e cole o link na constante `SHEET_CSV_URL` no topo do arquivo.
5. Pronto.

## Trocar a logo

No `index.html` há dois blocos `<div class="logo-mark">` (header e rodapé) reservando o espaço da logo. Quando ela estiver pronta em vetor/PNG, troque por:

```html
<img class="logo-mark" src="assets/logo.svg" alt="Fyah Headshop">
```

(ajuste o CSS de `.logo-mark` se precisar remover a borda tracejada).

## Deploy (qualquer uma das opções abaixo, sem custo)

- **Netlify** — arrasta a pasta inteira em app.netlify.com/drop
- **Vercel** — `vercel` na pasta do projeto (CLI) ou importar o repositório
- **GitHub Pages** — sobe a pasta num repositório e ativa Pages nas configurações

Nenhuma dessas opções exige servidor próprio ou banco de dados — é só arquivos estáticos.