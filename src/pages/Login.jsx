import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Um único componente cobre login e criação de conta, alternando o modo
// com esse estado. Isso evita duplicar o formulário inteiro em dois
// arquivos separados, já que a diferença entre os dois é só qual função
// do Supabase é chamada no fim.
export default function Login() {
  const [modo, setModo] = useState('entrar') // 'entrar' | 'cadastrar'
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [mensagem, setMensagem] = useState(null)
  const [enviando, setEnviando] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setMensagem(null)
    setEnviando(true)

    if (modo === 'entrar') {
      // signInWithPassword confere email+senha contra o que o Supabase
      // Auth já tem cadastrado. Se bater, ele cria a sessão sozinho, e o
      // useAuth (que está rodando em paralelo no App.jsx) percebe essa
      // mudança e troca a tela automaticamente, sem precisarmos fazer
      // nenhum redirecionamento manual aqui.
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
      if (error) setMensagem(error.message)
    } else {
      // signUp cria o usuário. Por padrão o Supabase exige confirmação
      // por e-mail antes de liberar o login (você recebe um link na
      // caixa de entrada). Isso é uma proteção contra alguém cadastrar
      // um e-mail que não é seu; pra um app de uso só seu, é tranquilo
      // confirmar uma vez e nunca mais precisar pensar nisso.
      const { error } = await supabase.auth.signUp({ email, password: senha })
      if (error) {
        setMensagem(error.message)
      } else {
        setMensagem('Conta criada. Verifique seu e-mail para confirmar antes de entrar.')
      }
    }

    setEnviando(false)
  }

  return (
    <div style={estilos.container}>
      <div style={estilos.card}>
        <h1 style={estilos.titulo}>anperez.money</h1>
        <p style={estilos.subtitulo}>
          {modo === 'entrar' ? 'Entre com sua conta' : 'Crie sua conta'}
        </p>

        <form onSubmit={handleSubmit} style={estilos.form}>
          <input
            type="email"
            placeholder="e-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={estilos.input}
          />
          <input
            type="password"
            placeholder="senha"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
            minLength={6}
            style={estilos.input}
          />

          {mensagem && <p style={estilos.mensagem}>{mensagem}</p>}

          <button type="submit" disabled={enviando} style={estilos.botao}>
            {enviando ? 'Aguarde...' : modo === 'entrar' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>

        <button
          onClick={() => { setModo(modo === 'entrar' ? 'cadastrar' : 'entrar'); setMensagem(null) }}
          style={estilos.link}
        >
          {modo === 'entrar' ? 'Ainda não tem conta? Criar uma' : 'Já tem conta? Entrar'}
        </button>
      </div>
    </div>
  )
}

// Estilos inline por enquanto, só pra tela ficar apresentável. Quando
// tivermos mais telas, vale a pena migrar isso pra um arquivo CSS
// compartilhado em src/styles/, mas não vamos otimizar isso agora.
const estilos = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'sans-serif',
  },
  card: {
    background: '#111827',
    padding: '2rem',
    borderRadius: '12px',
    width: '100%',
    maxWidth: '360px',
    border: '1px solid #1f2937',
  },
  titulo: { margin: 0, color: '#e5e7eb' },
  subtitulo: { color: '#9ca3af', marginTop: '0.25rem', marginBottom: '1.5rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  input: {
    padding: '0.6rem 0.8rem',
    borderRadius: '8px',
    border: '1px solid #374151',
    background: '#0b0f19',
    color: '#e5e7eb',
  },
  botao: {
    padding: '0.6rem',
    borderRadius: '8px',
    border: 'none',
    background: '#42A5F5',
    color: '#0b0f19',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  link: {
    background: 'none',
    border: 'none',
    color: '#42A5F5',
    marginTop: '1rem',
    cursor: 'pointer',
    fontSize: '0.85rem',
  },
  mensagem: { color: '#FFB74D', fontSize: '0.85rem', margin: 0 },
}
