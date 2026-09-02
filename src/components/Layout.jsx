import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabaseClient'
import { useContaAtiva } from '../context/ContaAtivaContext'
import { useEhMobile } from '../hooks/useMediaQuery'
import CaberNaTela from './CaberNaTela'
import logo from '../assets/logo.png'

// Ítems de la barra inferior móvil. keeps los mismos destinos que el menu
// de escritorio; en pantalla pequeña se muestran como iconos + label corto.
const NAV_ITEMS = [
  { to: '/', end: true, rotulo: 'Início', icono: 'inicio' },
  { to: '/planejamento', rotulo: 'Planejamento', icono: 'planejamento' },
  { to: '/ponto', rotulo: 'Ponto', icono: 'ponto' },
  { to: '/contas', rotulo: 'Contas', icono: 'contas' },
  { to: '/cartoes', rotulo: 'Cartões', icono: 'cartoes' },
]

// Iconos SVG en línea (trazo fino, mismo estilo que HomeCard). Sin
// dependencias; se usan una única vez en la bottom nav.
function Icono({ nombre }) {
  const stroke = { stroke: 'currentColor', strokeWidth: 2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }
  const path = (d) => <path d={d} {...stroke} />
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...stroke}>
      {nombre === 'inicio' && (
        <>
          {path('M4 9h16')}
          {path('M4 20h16v8')}
          {path('M4 9l6-4 6 4')}
        </>
      )}
      {nombre === 'contas' && (
        <>
          {path('M3 21h18')}
          {path('M4 21V10l8-6 8 6v11')}
          {path('M12 21v-6h6v6')}
        </>
      )}
      {nombre === 'cartoes' && (
        <>
          <rect x="2" y="5" width="20" height="14" rx="3" {...stroke} />
          {path('M2 10h20')}
          {path('M6 15h4')}
        </>
      )}
      {nombre === 'config' && (
        <>
          {path('M4 6h10')}
          {path('M18 6h2')}
          <circle cx="16" cy="6" r="2" {...stroke} />
          {path('M4 12h2')}
          {path('M10 12h10')}
          <circle cx="8" cy="12" r="2" {...stroke} />
          {path('M4 18h10')}
          {path('M18 18h2')}
          <circle cx="16" cy="18" r="2" {...stroke} />
        </>
      )}
      {nombre === 'planejamento' && (
        <>
          {path('M3 5h18v16H3z')}
          {path('M8 3v4')}
          {path('M16 3v4')}
          {path('M3 10h18')}
          {path('M9 15l2 2 4-4')}
        </>
      )}
      {nombre === 'ponto' && (
        <>
          <circle cx="12" cy="12" r="9" {...stroke} />
          {path('M12 7v5l3 2')}
        </>
      )}
    </svg>
  )
}

// Moldura de las telas autenticadas: cabecera y Outlet. En móvil el menú
// se vuelve una barrón inferior fija (bottom nav) y la cabecera queda
// compacta (logo + píldoras de cuenta + botón de perfil). En escritorio,
// todo sigue en la línea de la cabecera como antes.
export default function Layout() {
  const { usuario } = useAuth()
  const { contaAtiva, setContaAtiva, contas, carregando } = useContaAtiva()
  const ehMobile = useEhMobile()
  const [menuAberto, setMenuAberto] = useState(false)
  const [perfilAberto, setPerfilAberto] = useState(false)
  const localizacao = useLocation()

  // Trocou de ruta → cierra ambos menús.
  useEffect(() => {
    setMenuAberto(false)
    setPerfilAberto(false)
  }, [localizacao.pathname])

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  // Píldoras de la cuenta activa, con scroll horizontal propio en móvil
  // para no empujar el layout cuando hay varias cuentas.
  function SeletorContas({ horizontal = false }) {
    const contenedor = horizontal ? estilos.seletorContaMobile : estilos.seletorConta
    return (
      <div style={contenedor}>
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
    )
  }

  // Menú de navegación de escritorio (destinos del menu habitual).
  function LinksMenu() {
    return (
      <>
        <NavLink to="/" end style={({ isActive }) => (isActive ? estilos.linkAtivo : estilos.link)}>
          Início
        </NavLink>
        <NavLink to="/planejamento" style={({ isActive }) => (isActive ? estilos.linkAtivo : estilos.link)}>
          Planejamento
        </NavLink>
        <NavLink to="/ponto" style={({ isActive }) => (isActive ? estilos.linkAtivo : estilos.link)}>
          Ponto
        </NavLink>
        <NavLink to="/contas" style={({ isActive }) => (isActive ? estilos.linkAtivo : estilos.link)}>
          Contas Correntes
        </NavLink>
        <NavLink to="/cartoes" style={({ isActive }) => (isActive ? estilos.linkAtivo : estilos.link)}>
          Cartões
        </NavLink>
        <span style={estilos.separador} aria-hidden="true" />
        <NavLink to="/configuracoes" style={({ isActive }) => (isActive ? estilos.linkAtivo : estilos.link)}>
          Configurações
        </NavLink>
      </>
    )
  }

  // Página de detalhe da fatura (/cartoes/:id) é longa, mas com a rolagem
  // de página em TODAS as resoluções o rodapé (Pagar fatura, Desfazer,
  // ações) flui naturalmente — não precisa de tratamento especial aqui.

  return (
    <div className="tela-inteira" style={estilos.pagina}>
      <header style={{ ...estilos.cabecalho, ...(ehMobile ? estilos.cabecalhoMobile : null) }}>
        <div style={estilos.linhaCabecalho}>
          <img src={logo} alt="ANPEREZ Money" style={estilos.logo} />

          {/* Escritorio: seletor + menú + e-mail + Sair en la línea. */}
          {!ehMobile && (
            <>
              <SeletorContas />
              <nav style={estilos.menu}>
                <LinksMenu />
              </nav>
              <div style={estilos.usuario}>
                <span style={estilos.email}>{usuario?.email}</span>
                <button onClick={handleLogout} style={estilos.botaoSair}>
                  Sair
                </button>
              </div>
            </>
          )}

          {/* Móvil: píldoras + botón de perfil (el menú va abajo en la
              bottom nav). */}
          {ehMobile && (
            <>
              <SeletorContas horizontal />
              <button
                onClick={() => setPerfilAberto((abierto) => !abierto)}
                style={estilos.botonPerfil}
                aria-label="Cuenta de usuario"
                aria-expanded={perfilAberto}
              >
                {(usuario?.email ?? '?').trim().charAt(0).toUpperCase()}
              </button>
            </>
          )}
        </div>

        {/* Dropdown de perfil: e-mail completo + Configurações + Trocar senha
            + Sair (móvil). Mantém o e-mail visível — é a referência de "essa
            é a minha conta" no meio de tantos módulos numéricos do app. */}
        {ehMobile && perfilAberto && (
          <div style={estilos.dropdownPerfil}>
            <span style={estilos.emailDropdown}>{usuario?.email}</span>
            <NavLink
              to="/configuracoes"
              style={estilos.linkPerfil}
              onClick={() => setPerfilAberto(false)}
            >
              Configurações
            </NavLink>
            <button onClick={handleLogout} style={estilos.botaoSairPerfil}>
              Sair
            </button>
          </div>
        )}
      </header>

      {/* Contenido de la ruta. En móvil la página roe (ver global.css:
          .tela-inteira muda a overflow visible bajo 640px). */}
      <main style={ehMobile ? { ...estilos.principal, paddingBottom: '4.5rem' } : estilos.principal}>
        <CaberNaTela maxLargura={720}>
          <Outlet />
        </CaberNaTela>
      </main>

      {/* Bottom nav (móvil): barra fija inferior, estilo app bancaria. */}
      {ehMobile && (
        <nav style={estilos.bottomNav} aria-label="Navegación principal">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              style={({ isActive }) => ({
                ...estilos.bottomNavItem,
                ...(isActive ? estilos.bottomNavItemActivo : null),
              })}
            >
              <Icono nombre={item.icono} />
              <span>{item.rotulo}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}

const estilos = {
  pagina: {
    fontFamily: 'san-serif',
    background: '#0b0f19',
    color: '#e5e7eb',
  },
  principal: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  cabecalho: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    padding: '1rem 2rem',
    borderBottom: '1px solid #1f2937',
    background: '#0b0f19',
    // Respeita o notch/ilha do iPhone quando o app roda em modo standalone.
    paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))',
    paddingLeft: 'calc(2rem + env(safe-area-inset-left, 0px))',
    paddingRight: 'calc(2rem + env(safe-area-inset-right, 0px))',
  },
  cabecalhoMobile: {
    // En móvil el header es fijo arriba mientras roe el contenido.
    position: 'sticky',
    top: 0,
    zIndex: 30,
    padding: '0.5rem 0.75rem',
    paddingTop: 'calc(0.5rem + env(safe-area-inset-top, 0px))',
    paddingLeft: 'calc(0.75rem + env(safe-area-inset-left, 0px))',
    paddingRight: 'calc(0.75rem + env(safe-area-inset-right, 0px))',
    gap: '0.4rem',
  },
  linhaCabecalho: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem',
    width: '100%',
  },
  logo: { height: '30px', width: '30px', borderRadius: '6px', display: 'block', flexShrink: 0 },
  seletorConta: { display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' },
  seletorContaMobile: {
    display: 'flex',
    gap: '0.4rem',
    alignItems: 'center',
    overflowX: 'auto',
    flexWrap: 'nowrap',
    flex: 1,
    minWidth: 0,
    WebkitOverflowScrolling: 'touch',
    paddingTop: '0.2rem',
    paddingBottom: '0.25rem',
  },
  conta: {
    padding: '0.35rem 0.7rem',
    borderRadius: '999px',
    border: '1px solid #374151',
    background: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '0.85rem',
    whiteSpace: 'nowrap',
    textAlign: 'left',
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
    textAlign: 'left',
  },
  carregandoConta: { color: '#9ca3af', fontSize: '0.85rem' },
  botonPerfil: {
    flexShrink: 0,
    width: '38px',
    height: '38px',
    borderRadius: '999px',
    border: '1px solid #374151',
    background: '#1f2937',
    color: '#e5e7eb',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: 'bold',
    fontFamily: 'inherit',
    lineHeight: 1,
  },
  dropdownPerfil: {
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: '10px',
    padding: '0.75rem 1rem',
  },
  emailDropdown: {
    display: 'block',
    color: '#9ca3af',
    fontSize: '0.8rem',
    wordBreak: 'break-all',
    marginBottom: '0.5rem',
  },
  linkPerfil: {
    display: 'block',
    color: '#e5e7eb',
    textDecoration: 'none',
    padding: '0.5rem 0.4rem',
    borderRadius: '8px',
    borderBottom: '1px solid #1f2937',
  },
  botaoSairPerfil: {
    display: 'block',
    width: '100%',
    marginTop: '0.4rem',
    padding: '0.5rem 0.4rem',
    borderRadius: '8px',
    border: '1px solid #374151',
    background: 'none',
    color: '#f87171',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  menu: { display: 'flex', gap: '1.25rem', alignItems: 'center', flexWrap: 'wrap' },
  separador: {
    width: '1px',
    height: '1.4rem',
    background: '#374151',
    alignSelf: 'center',
  },
  link: {
    color: '#9ca3af',
    textDecoration: 'none',
    padding: '0.6rem 0.9rem',
    borderRadius: '8px',
    display: 'block',
  },
  linkActivo: {
    color: '#42A5F5',
    textDecoration: 'none',
    padding: '0.6rem 0.9rem',
    borderRadius: '8px',
    background: '#1f2937',
    fontWeight: 'bold',
    display: 'block',
  },
  usuario: { display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 },
  email: {
    color: '#9ca3af',
    fontSize: '0.85rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '220px',
  },
  botaoSair: {
    padding: '0.5rem 0.9rem',
    borderRadius: '8px',
    border: '1px solid #374151',
    background: 'none',
    color: '#e5e7eb',
    cursor: 'pointer',
    fontFamily: 'inherit',
    flexShrink: 0,
  },
  bottomNav: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-around',
    background: '#0b0f19',
    borderTop: '1px solid #1f2937',
    paddingTop: '0.4rem',
    // Deja hueco para la barra del sistema (home indicator del iPhone).
    paddingBottom: 'calc(0.4rem + env(safe-area-inset-bottom, 0px))',
  },
  bottomNavItem: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.15rem',
    padding: '0.35rem 0',
    color: '#9ca3af',
    textDecoration: 'none',
    fontSize: '0.68rem',
    fontFamily: 'inherit',
    minHeight: '44px',
    justifyContent: 'center',
  },
  bottomNavItemActivo: {
    color: '#42A5F5',
  },
}