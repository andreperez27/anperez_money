import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ContasCorrentes from './pages/ContasCorrentes'
import Movimentacoes from './pages/Movimentacoes'
import Cartoes from './pages/Cartoes'
import Caixinhas from './pages/Caixinhas'
import CaixinhaDetalhe from './pages/CaixinhaDetalhe'
import Relatorios from './pages/Relatorios'
import Configuracoes from './pages/Configuracoes'
import Ponto from './pages/Ponto'
import Layout from './components/Layout'
import { ContaAtivaProvider } from './context/ContaAtivaContext'

// Guardião das rotas autenticadas. Reusa o useAuth (mesma sessão do
// Supabase, sem sistema paralelo): enquanto a checagem de sessão
// acontece, mostra o carregando (evita o pisca de tela); sem sessão,
// redireciona para o login via <Navigate replace>. A proteção é
// controle de fluxo/UX — a segurança REAL dos dados continua sendo o
// RLS no banco (inclusive para quem contornar o frontend).
function RequerLogin({ children }) {
  const { logado, carregando } = useAuth()

  if (carregando) {
    return (
      <div style={{ fontFamily: 'sans-serif', padding: '2rem', color: '#9ca3af' }}>
        Carregando...
      </div>
    )
  }

  if (!logado) {
    return <Navigate to="/login" replace />
  }

  return children
}

// Espelho do RequerLogin para a rota pública: quem JÁ está logado e
// visita /login é devolvido para o Dashboard (replace = o histórico
// não guarda o passo pelo login).
function SomenteDeslogado({ children }) {
  const { logado, carregando } = useAuth()

  if (carregando) {
    return (
      <div style={{ fontFamily: 'sans-serif', padding: '2rem', color: '#9ca3af' }}>
        Carregando...
      </div>
    )
  }

  if (logado) {
    return <Navigate to="/" replace />
  }

  return children
}

// Mapa de rotas do app:
// - /login é pública (e redireciona se já logado)
// - "/" (Home) é protegida e renderiza a tela inicial mobile-first,
//   sem a moldura escura do Layout — é o cartão de entrada do app
// - As demais telas (contas, movimentacoes, cartoes, caixinhas,
//   relatorios, configuracoes) usam o Layout: cabeçalho + menu + Outlet
// - O menu do cabeçalho expõe Início | Contas Correntes | Cartões |
//   Configurações; caixinhas e extrato vivem dentro de Contas Correntes
// - /caixinhas lista as caixinhas da conta ativa; /caixinhas/:id abre o
//   detalhe de uma caixinha (Guardar / Resgatar / Extrato)
// - "*" (qualquer URL desconhecida) cai em "/"
// O basename "/anperez-money" já está configurado no main.jsx.
function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <SomenteDeslogado>
            <Login />
          </SomenteDeslogado>
        }
      />
      <Route
        path="/"
        element={
          <RequerLogin>
            <ContaAtivaProvider>
              <Dashboard />
            </ContaAtivaProvider>
          </RequerLogin>
        }
      />
      <Route
        path="/contas"
        element={
          <RequerLogin>
            <ContaAtivaProvider>
              <Layout />
            </ContaAtivaProvider>
          </RequerLogin>
        }
      >
        <Route index element={<ContasCorrentes />} />
      </Route>
      <Route
        path="/movimentacoes"
        element={
          <RequerLogin>
            <ContaAtivaProvider>
              <Layout />
            </ContaAtivaProvider>
          </RequerLogin>
        }
      >
        <Route index element={<Movimentacoes />} />
      </Route>
      <Route
        path="/cartoes"
        element={
          <RequerLogin>
            <ContaAtivaProvider>
              <Layout />
            </ContaAtivaProvider>
          </RequerLogin>
        }
      >
        <Route index element={<Cartoes />} />
      </Route>
      <Route
        path="/caixinhas"
        element={
          <RequerLogin>
            <ContaAtivaProvider>
              <Layout />
            </ContaAtivaProvider>
          </RequerLogin>
        }
      >
        <Route index element={<Caixinhas />} />
      </Route>
      <Route
        path="/caixinhas/:id"
        element={
          <RequerLogin>
            <ContaAtivaProvider>
              <Layout />
            </ContaAtivaProvider>
          </RequerLogin>
        }
      >
        <Route index element={<CaixinhaDetalhe />} />
      </Route>
      <Route
        path="/relatorios"
        element={
          <RequerLogin>
            <ContaAtivaProvider>
              <Layout />
            </ContaAtivaProvider>
          </RequerLogin>
        }
      >
        <Route index element={<Relatorios />} />
      </Route>
      <Route
        path="/ponto"
        element={
          <RequerLogin>
            <ContaAtivaProvider>
              <Layout />
            </ContaAtivaProvider>
          </RequerLogin>
        }
      >
        <Route index element={<Ponto />} />
      </Route>
      <Route
        path="/configuracoes"
        element={
          <RequerLogin>
            <ContaAtivaProvider>
              <Layout />
            </ContaAtivaProvider>
          </RequerLogin>
        }
      >
        <Route index element={<Configuracoes />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App