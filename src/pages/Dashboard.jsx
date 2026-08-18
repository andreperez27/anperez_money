import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useContas } from '../hooks/useContas'
import { supabase } from '../lib/supabaseClient'

// Formata 1500.5 como "R$ 1.500,50".
const formatoReal = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

// A tela pós-login. Enquanto não existir rota própria, lista de contas
// e o formulário de criação moram aqui.
export default function Dashboard() {
  const { usuario } = useAuth()
  const { contas, carregando, erro, criarConta } = useContas()

  // Estado do formulário de nova conta. São "inputs controlados": o valor
  // digitado mora no estado do React (não no DOM), então o componente
  // sempre sabe exatamente o que está no campo.
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState('corrente')
  const [saldo, setSaldo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [mensagem, setMensagem] = useState(null)

  async function handleCriarConta(e) {
    e.preventDefault()
    setEnviando(true)
    setMensagem(null)

    try {
      await criarConta({
        nome: nome.trim(),
        tipo,
        saldo_atual: Number(saldo) || 0,
      })
      setNome('')
      setSaldo('')
      setMensagem({ tipo: 'ok', texto: `Conta "${nome.trim()}" criada.` })
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: `Não foi possível criar: ${err.message}` })
    } finally {
      setEnviando(false)
    }
  }

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
        <section style={estilos.secao}>
          <h2>Nova conta</h2>
          <form onSubmit={handleCriarConta} style={estilos.form}>
            <input
              type="text"
              placeholder="Nome (ex.: Carteira)"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              style={estilos.input}
            />
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              style={estilos.input}
            >
              <option value="corrente">corrente</option>
              <option value="poupanca">poupança</option>
              <option value="carteira">carteira</option>
            </select>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="Saldo inicial (R$)"
              value={saldo}
              onChange={(e) => setSaldo(e.target.value)}
              style={estilos.input}
            />
            <button type="submit" disabled={enviando} style={estilos.botaoCriar}>
              {enviando ? 'Criando...' : 'Criar conta'}
            </button>
          </form>

          {mensagem && (
            <p style={mensagem.tipo === 'ok' ? estilos.mensagemOk : estilos.mensagemErro}>
              {mensagem.texto}
            </p>
          )}
        </section>

        <section style={estilos.secao}>
          <h2>Contas</h2>

          {carregando && <p style={estilos.mensagem}>Carregando contas...</p>}

          {erro && (
            <p style={estilos.erro}>
              Não foi possível carregar suas contas: {erro}
            </p>
          )}

          {!carregando && !erro && contas.length === 0 && (
            <p style={estilos.mensagem}>Nenhuma conta cadastrada ainda.</p>
          )}

          {!carregando && !erro && contas.length > 0 && (
            <ul style={estilos.lista}>
              {contas.map((conta) => (
                <li key={conta.id} style={estilos.item}>
                  <div>
                    <span style={estilos.nomeConta}>{conta.nome}</span>
                    <span style={estilos.tipoConta}>{conta.tipo}</span>
                  </div>
                  <span style={estilos.saldo}>
                    {formatoReal.format(Number(conta.saldo_atual))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
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
  secao: { marginBottom: '2rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '340px' },
  input: {
    padding: '0.6rem 0.8rem',
    borderRadius: '8px',
    border: '1px solid #374151',
    background: '#111827',
    color: '#e5e7eb',
  },
  botaoCriar: {
    padding: '0.6rem',
    borderRadius: '8px',
    border: 'none',
    background: '#42A5F5',
    color: '#0b0f19',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  mensagem: { color: '#9ca3af' },
  erro: { color: '#ef4444' },
  mensagemOk: { color: '#4ade80' },
  mensagemErro: { color: '#ef4444' },
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
  nomeConta: { fontWeight: 'bold' },
  tipoConta: { color: '#9ca3af', marginLeft: '0.6rem', fontSize: '0.85rem' },
  saldo: { fontWeight: 'bold', color: '#42A5F5' },
}