import { useAuth } from './hooks/useAuth'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'

// Este é o "portão de entrada" do app inteiro. A lógica é simples de
// propósito: enquanto o useAuth ainda não terminou de checar se existe
// sessão salva, mostramos um "carregando" (pra evitar o famoso pisca de
// tela de login aparecendo por meio segundo antes do Dashboard). Depois
// disso, é um if simples: logado vê Dashboard, não logado vê Login.
//
// Quando adicionarmos mais telas (Contas, Movimentações), é aqui que o
// react-router-dom vai entrar de fato, com rotas de verdade. Por
// enquanto, com só duas telas possíveis, esse if resolve sem
// complexidade desnecessária.
function App() {
  const { logado, carregando } = useAuth()

  if (carregando) {
    return (
      <div style={{ fontFamily: 'sans-serif', padding: '2rem', color: '#9ca3af' }}>
        Carregando...
      </div>
    )
  }

  return logado ? <Dashboard /> : <Login />
}

export default App
