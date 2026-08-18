import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'

// Ainda é um placeholder: o objetivo agora é só confirmar que, uma vez
// logado, você chega até aqui, e que o botão de sair encerra a sessão de
// verdade. As telas de contas e movimentações substituem este conteúdo
// no próximo passo.
export default function Dashboard() {
  const { usuario } = useAuth()

  async function handleLogout() {
    // signOut invalida o token guardado no navegador. O useAuth percebe
    // a mudança (via onAuthStateChange) e o App.jsx te devolve pra tela
    // de Login automaticamente.
    await supabase.auth.signOut()
  }

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', color: '#e5e7eb' }}>
      <h1>anperez.money</h1>
      <p>Logado como: {usuario?.email}</p>
      <button onClick={handleLogout} style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}>
        Sair
      </button>
      <p style={{ marginTop: '2rem', color: '#9ca3af' }}>
        Próximo passo: as telas de contas e movimentações entram aqui.
      </p>
    </div>
  )
}
