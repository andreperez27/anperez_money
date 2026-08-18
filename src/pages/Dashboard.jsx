import { useAuth } from '../hooks/useAuth'
import { useContas } from '../hooks/useContas'
import { supabase } from '../lib/supabaseClient'

// Formata 1500.5 como "R$ 1.500,50". O Intl.NumberFormat segue as regras
// do locale pt-BR (ponto nos milhares, vírgula nos centavos) e substitui
// qualquer formatação manual cheia de `toFixed` e concatenação.
const formatoReal = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

// A tela pós-login. Enquanto não existir uma rota /contas de verdade,
// a lista de contas mora aqui. O useContas cuida da busca e dos estados;
// este componente só decide o que renderizar pra cada estado.
export default function Dashboard() {
  const { usuario } = useAuth()
  const { contas, carregando, erro } = useContas()

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  return (
    <div style={estilos.pagina}>
      <header style={estilos.cabecalho}>
        <h1 style={estilos.titulo}>anperez.money</h1>
        <div style={estilos.usuario}>
          <span>{usuario?.email}</span>
          <button onClick={handleLogout} style={estilos.botaoSair}>
            Sair
          </button>
        </div>
      </header>

      <main style={estilos.conteudo}>
        <h2>Contas</h2>

        {carregando && <p style={estilos.mensagem}>Carregando contas...</p>}

        {erro && (
          <p style={estilos.erro}>
            Não foi possível carregar suas contas: {erro}
          </p>
        )}

        {!carregando && !erro && contas.length === 0 && (
          <p style={estilos.mensagem}>
            Nenhuma conta cadastrada ainda.
          </p>
        )}

        {!carregando && !erro && contas.length > 0 && (
          <ul style={estilos.lista}>
            {contas.map((conta) => (
              <li key={conta.id} style={estilos.item}>
                <div>
                  <span style={estilos.nome}>{conta.nome}</span>
                  <span style={estilos.tipo}>{conta.tipo}</span>
                </div>
                <span style={estilos.saldo}>
                  {formatoReal.format(Number(conta.saldo_atual))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

const estilos = {
  pagina: {
    minHeight: '100vh',
    fontFamily: 'sans-serif',
    background: '#0b0f19',
    color: '#e5e7eb',
  },
  cabecalho: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '1rem 2rem',
    borderBottom: '1px solid #1f2937',
  },
  titulo: { margin: 0, fontSize: '1.25rem' },
  usuario: { display: 'flex', alignItems: 'center', gap: '1rem' },
  botaoSair: {
    padding: '0.4rem 0.9rem',
    borderRadius: '8px',
    border: '1px solid #374151',
    background: 'none',
    color: '#e5e7eb',
    cursor: 'pointer',
  },
  conteudo: { padding: '2rem', maxWidth: '720px', margin: '0 auto' },
  mensagem: { color: '#9ca3af' },
  erro: { color: '#ef4444' },
  lista: { listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.9rem 1.1rem',
    borderRadius: '10px',
    background: '#111827',
    border: '1px solid #1f2937',
  },
  nome: { fontWeight: 'bold' },
  tipo: { color: '#9ca3af', marginLeft: '0.6rem', fontSize: '0.85rem' },
  saldo: { fontWeight: 'bold', color: '#42A5F5' },
}