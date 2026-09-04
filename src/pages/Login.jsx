import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import CaberNaTela from '../components/CaberNaTela'
import logo from '../assets/logo.png'

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
      // mudança e troca a tela automaticamente.
      const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
      if (error) setMensagem(error.message)
    } else {
      // signUp cria o usuário. Por padrão o Supabase exige confirmação
      // por e-mail antes de liberar o login.
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
    <div className="tela-inteira" style={estilos.container}>
      <CaberNaTela maxLargura={380} alinhamento="center">
        <div style={estilos.card}>
          <img src={logo} alt="ANPEREZ Money" style={estilos.logo} />
          <h1 style={estilos.titulo}>ANPEREZ Money</h1>
          <p style={estilos.subtitulo}>
            {modo === 'entrar' ? 'Entre com sua conta' : 'Crie sua conta'}
          </p>

          <form onSubmit={handleSubmit} style={estilos.form} noValidate={false}>
            <label style={estilos.label}>
              E-mail
              <input
                type="email"
                placeholder="voce@exemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                spellCheck={false}
                required
                style={estilos.input}
              />
            </label>
            <label style={estilos.label}>
              Senha
              <input
                type="password"
                placeholder="••••••••"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'}
                required
                minLength={6}
                style={estilos.input}
              />
            </label>

            {mensagem && <p style={estilos.mensagem}>{mensagem}</p>}

            <button type="submit" disabled={enviando} style={enviando ? { ...estilos.botao, opacity: 0.6 } : estilos.botao}>
              {enviando ? 'Aguarde…' : modo === 'entrar' ? 'Entrar' : 'Criar conta'}
            </button>
          </form>

          <button
            type="button"
            onClick={() => { setModo(modo === 'entrar' ? 'cadastrar' : 'entrar'); setMensagem(null) }}
            style={estilos.link}
          >
            {modo === 'entrar' ? 'Ainda não tem conta? Criar uma' : 'Já tem conta? Entrar'}
          </button>
        </div>
      </CaberNaTela>
    </div>
  )
}

const estilos = {
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Space Grotesk', system-ui, sans-serif",
    background:
      'radial-gradient(1000px 500px at 20% -10%, rgba(66,165,245,0.12), transparent 60%), radial-gradient(900px 480px at 110% 110%, rgba(74,222,128,0.08), transparent 60%), #0b0f19',
  },
  card: {
    background: 'linear-gradient(180deg, #131a2b 0%, #0f1422 100%)',
    padding: '2.2rem',
    borderRadius: '18px',
    width: '100%',
    maxWidth: '380px',
    border: '1px solid #1f2937',
  },
  logo: {
    display: 'block',
    width: '72px',
    height: '72px',
    margin: '0 auto 1rem',
    borderRadius: '16px',
  },
  titulo: {
    margin: 0,
    textAlign: 'center',
    color: '#f8fafc',
    fontSize: '1.4rem',
    fontWeight: 700,
  },
  subtitulo: { color: '#9ca3af', textAlign: 'center', marginTop: '0.4rem', marginBottom: '1.5rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.85rem' },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
    color: '#9ca3af',
    fontSize: '0.8rem',
    fontWeight: 600,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '0.65rem 0.85rem',
    borderRadius: '10px',
    border: '1px solid #374151',
    background: '#0b0f19',
    color: '#e5e7eb',
    transition: 'border-color 150ms ease',
  },
  botao: {
    marginTop: '0.35rem',
    padding: '0.7rem',
    borderRadius: '10px',
    border: 'none',
    background: 'linear-gradient(180deg, #64b5f6 0%, #42A5F5 100%)',
    color: '#0b0f19',
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'filter 150ms ease, transform 80ms ease',
  },
  link: {
    background: 'none',
    border: 'none',
    color: '#42a5f5',
    marginTop: '1.1rem',
    cursor: 'pointer',
    fontSize: '0.85rem',
    width: '100%',
  },
  mensagem: { color: '#FFB74D', fontSize: '0.85rem', margin: 0 },
}
