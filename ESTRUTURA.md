# Estrutura de pastas — anperez-money

```
anperez-money/
├── .github/
│   └── workflows/
│       └── deploy.yml          # automação: publica no GitHub Pages a cada push
├── supabase/
│   └── 01_schema_contas_movimentacoes.sql
├── public/                     # arquivos estáticos (ícone, favicon), copiados sem alteração
├── src/
│   ├── main.jsx                # ponto de entrada, onde o React "liga" na página
│   ├── App.jsx                 # componente raiz, decide qual tela mostrar
│   ├── lib/
│   │   └── supabaseClient.js   # conexão única com o Supabase, reaproveitada em todo o app
│   ├── pages/
│   │   ├── Login.jsx
│   │   ├── Dashboard.jsx
│   │   ├── Contas.jsx
│   │   └── Movimentacoes.jsx
│   ├── components/             # pedaços de UI reaproveitáveis (botão, card de saldo, tabela)
│   ├── hooks/                  # lógica reaproveitável (ex.: "usar dados de movimentações")
│   └── styles/
├── .env.local                  # suas chaves do Supabase (NUNCA vai pro GitHub)
├── .env.example                # modelo do .env, sem valores reais, esse sim vai pro GitHub
├── .gitignore
├── package.json
└── DIARIO_DE_BORDO.md
```

## Por que essa divisão

**`pages/` vs `components/`** é a distinção mais importante de entender. Uma
"page" é uma tela inteira, algo que ocupa a rota inteira do navegador (você
acessa `/movimentacoes` e vê a página Movimentacoes). Um "component" é um
pedaço menor, reaproveitável em várias páginas: o card que mostra o saldo de
uma conta, por exemplo, vai aparecer tanto no Dashboard quanto na página de
Contas, então ele vive em `components/`, não duplicado dentro de cada page.

**`lib/supabaseClient.js`** existe pra você nunca precisar escrever
`createClient(...)` mais de uma vez no projeto inteiro. Toda página que
precisa falar com o banco importa esse arquivo único. Se um dia a
configuração de conexão mudar, você ajusta em um lugar só.

**`hooks/`** é onde mora lógica que se repete entre telas, mas que não é
visual. Por exemplo: tanto o Dashboard quanto a página de Movimentações vão
precisar buscar a lista de movimentações do mês. Em vez de copiar essa busca
duas vezes, ela vira um hook (`useMovimentacoes`) usado nos dois lugares.

**`.env.local` separado do `.env.example`** é o ponto mais importante de
segurança nessa estrutura. O arquivo `.gitignore` (que criamos a seguir) vai
listar `.env.local` explicitamente, garantindo que ele nunca seja enviado
pro GitHub, mesmo que você rode `git add .` sem pensar. Já o `.env.example`
mostra o formato esperado (`VITE_SUPABASE_URL=`, `VITE_SUPABASE_ANON_KEY=`)
sem nenhum valor real preenchido, só pra documentação. Esse sim é seguro de
subir junto com o código.

**`.github/workflows/deploy.yml`** é o que transforma "salvei o código" em
"o site está atualizado no ar", automaticamente, toda vez que você sobe uma
mudança pro GitHub. É o mesmo mecanismo que você já usa no bolão.

## O que ainda falta criar

Essa é só a estrutura vazia. Os próximos arquivos, na ordem que vamos seguir,
são: `.gitignore` e `.env.example` (segurança primeiro), depois o
`package.json` inicial via Vite, depois `lib/supabaseClient.js`, e só então
a primeira tela de verdade, o Login.
