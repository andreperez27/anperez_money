import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// O "base" precisa bater exatamente com o nome do repositório no GitHub.
// Quando você acessa um GitHub Pages, a URL fica no formato
// https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/, e sem essa
// configuração o Vite gera links assumindo que o site vive na raiz do
// domínio, o que quebra CSS e JS em produção (funciona local, quebra no ar).
// Se você trocar o nome do repositório no GitHub, precisa atualizar aqui também.
// "server.host" expõe o dev server para a rede local (acesso pelo celular
// na mesma rede via http://IP-DA-MAQUINA:5173). Sem isso, o Vite escuta
// apenas em localhost.
// Versão do build (AAAA-MM-DD HH:MM): vai para o bundle (define) e para
// dist/versao.json (asset). O app compara os dois em tempo de execução e
// avisa quando há versão nova — sem isso, celular com página guardada em
// cache nunca percebe o deploy novo. Gerada uma vez por build, igual nos
// dois lugares.
const VERSAO_BUILD = new Date().toISOString().slice(0, 16).replace('T', ' ')

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'versao-app',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'versao.json',
          source: JSON.stringify({ versao: VERSAO_BUILD }),
        })
      },
    },
  ],
  define: {
    __VERSAO_APP__: JSON.stringify(VERSAO_BUILD),
  },
  base: '/anperez_money/',
  server: {
    host: true,
  },
})
