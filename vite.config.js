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
export default defineConfig({
  plugins: [react()],
  base: '/anperez_money/',
  server: {
    host: true,
  },
})
