import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabaseClient'
import { useContaAtiva } from '../context/ContaAtivaContext'
import CaberNaTela from './CaberNaTela'
import logo from '../assets/logo.png'

// Moldura das telas autenticadas: cabeçalho (menu, e-mail, Sair) e o
// Outlet, onde a página da URL atual é renderizada. O menu vive aqui
// uma única vez — trocar de rota não remonta o cabeçalho.
//
// NavLink vs Link: o Link navega; o NavLink navega E informa o estado
// ativo via callback (isActive), o que permite destacar o item atual.
// O "end" no link raiz impede que "/" fique ativo em todas as rotas
// (toda URL começa com "/" — sem "end", o Dashboard ficaria sempre
// destacado).
//
// O logout é a MESMA lógica da Etapa 04 (signOut; o useAuth percebe e
// o RequerLogin redireciona para /login). Nada de autenticação nova.
export default function Layout() {
  const { usuario } = useAuth()
  const { contaAtiva, setContaAtiva, contas, carregando } = useContaAtiva()

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  return (
    <div className="tela-inteira" style={estilos.pagina}>
      <header style={estilos.cabecalho}>
        <img src={logo} alt="ANPEREZ Money" style={estilos.logo} />

        {/* Seletor de conta ativa: uma pílula por conta, com destaque na
            selecionada. O click chama setContaAtiva do contexto — todas as
            telas filhas reagem à troca sozinhas. */}
        <div style={estilos.seletorConta}>
          {carregando && <span style={estilos.carregandoConta}>Carregando contas...</span>}
          {!carregando &&
            contas.map((conta) => {
              const ativa = conta.id === contaAtiva?.id
              return (
                <button
                  key={conta.id}
                  onClick={() => setContaAtiva(conta.id)}
                  style={ativa ? estilos.contaAtiva : estilos.conta}
                  title={ativa ? 'Conta ativa' : `Usar ${conta.nome}`}
                >
                  {conta.nome}
                </button>
              )
            })}
        </div>

        <nav style={estilos.menu}>
          <NavLink
            to="/"
            end
            style={({ isActive }) => (isActive ? estilos.linkAtivo : estilos.link)}
          >
            Início
          </NavLink>
          <NavLink
            to="/contas"
            style={({ isActive }) => (isActive ? estilos.linkAtivo : estilos.link)}
          >
            Contas Correntes
          </NavLink>
          <NavLink
            to="/cartoes"
            style={({ isActive }) => (isActive ? estilos.linkAtivo : estilos.link)}
          >
            Cartões
          </NavLink>

          {/* Separador: Configurações é ação rara (gerenciar contas,
              editar, desativar) e fica visualmente à parte do uso diário. */}
          <span style={estilos.separador} aria-hidden="true" />
          <NavLink
            to="/configuracoes"
            style={({ isActive }) => (isActive ? estilos.linkAtivo : estilos.link)}
          >
            Configurações
          </NavLink>
        </nav>

        <div style={estilos.usuario}>
          <span>{usuario?.email}</span>
          <button onClick={handleLogout} style={estilos.botaoSair}>
            Sair
          </button>
        </div>
      </header>

      {/* Conteúdo da rota: altura fixa da viewport, sem rolagem de
          página — caber na tela (CaberNaTela escala quando preciso) e
          rolagem só dentro das áreas de texto longo. */}
      <main style={estilos.principal}>
        <CaberNaTela maxLargura={720}>
          <Outlet />
        </CaberNaTela>
      </main>
    </div>
  )
}

const estilos = {
  pagina: {
    fontFamily: 'sans-serif',
    background: '#0b0f19',
    color: '#e5e7eb',
  },
  principal: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  cabecalho: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    padding: '1rem 2rem',
    borderBottom: '1px solid #1f2937',
    flexWrap: 'wrap',
  },
  logo: { height: '32px', width: '32px', borderRadius: '6px', display: 'block' },
  titulo: { margin: 0, fontSize: '1.25rem' },
  seletorConta: { display: 'flex', gap: '0.4rem', alignItems: 'center' },
  conta: {
    padding: '0.35rem 0.7rem',
    borderRadius: '999px',
    border: '1px solid #374151',
    background: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '0.85rem',
    whiteSpace: 'nowrap',
  },
  contaAtiva: {
    padding: '0.35rem 0.7rem',
    borderRadius: '999px',
    border: '1px solid #42A5F5',
    background: '#42A5F5',
    color: '#0b0f19',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
  },
  carregandoConta: { color: '#9ca3af', fontSize: '0.85rem' },
  menu: { display: 'flex', gap: '1.25rem', alignItems: 'center', flexWrap: 'wrap' },
  separador: {
    width: '1px',
    height: '1.4rem',
    background: '#374151',
    alignSelf: 'center',
  },
  link: { color: '#9ca3af', textDecoration: 'none', padding: '0.3rem 0.5rem', borderRadius: '6px' },
  linkAtivo: {
    color: '#42A5F5',
    textDecoration: 'none',
    padding: '0.3rem 0.5rem',
    borderRadius: '6px',
    background: '#1f2937',
    fontWeight: 'bold',
  },
  usuario: { display: 'flex', alignItems: 'center', gap: '1rem' },
  botaoSair: {
    padding: '0.4rem 0.9rem',
    borderRadius: '8px',
    border: '1px solid #374151',
    background: 'none',
    color: '#e5e7eb',
    cursor: 'pointer',
  },
}