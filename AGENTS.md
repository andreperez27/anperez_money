# Regras do projeto

## Idioma
Todo texto dirigido ao usuário (explicações, resumos, commits, diário, README)
deve ser escrito em **português do Brasil (pt-BR)**. Termos técnicos sem
tradução consagrada ficam em inglês, mas a frase inteira é em português.

## Commits (regra fixa do André)
Quando o André pedir para **commitar/pushar**, SEMPRE:

1. **Nunca commitar** a configuração local de ferramentas de desenvolvimento:
   - `.agents/` (scripts/instruções locais de skills e subagentes)
   - `skills-lock.json` (versões locais das skills baixadas)
   - `opencode.json` (config local do opencode — expõe o project-ref do
     Supabase e cabeçalhos com variáveis de ambiente)
   - Esses arquivos já estão no `.gitignore`; não remova essas linhas e não
     force `git add` por cima deles.

2. **Nunca commitar** artefatos locais de apoio nem relatórios gerados com
   valores financeiros reais:
   - `files.zip`, `layout_pagina_relatorios.html`
   - `scripts/relatorio_*.md` gerados pelas migrações (contêm saldos e
     valores reais; já estão no `.gitignore`)

3. Revisar antes do commit: `git status`, `git diff` e `git log --oneline -10`.
4. Mensagem de commit concisa, no estilo do histórico do repo (`Assunto: resumo
   da mudança + decisões`), prefixos como `Código:` / `Docs:` / `Banco:`.
   Commit só o que for solicitado; sem push a menos que pedido.