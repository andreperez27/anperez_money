import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// O "base" precisa bater exatamente com o nome do repositório no GitHub.
// Quando você acessa um GitHub Pages, a URL fica no formato
// https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/, e sem essa
// configuração o Vite gera links assumindo que o site vive na raiz do
// domínio, o que quebra CSS e JS em produção (funciona local, quebra no ar).
// Se você trocar o nome do repositório no GitHub, precisa atualizar aqui também.
export default defineConfig({
  plugins: [react()],
  base: '/anperez-money/',
})
