import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMuyEstrecho } from '../hooks/useMediaQuery'
import { useContaAtiva } from '../context/ContaAtivaContext'
import { useTodasCaixinhas } from '../hooks/useCaixinhas'
import { formatoReal } from '../lib/compartilhados'
import HomeCard, {
  IconeContas,
  IconeCartoes,
  IconeRelatorios,
  IconePonto,
  IconePlanejamento,
  IconeConfig,
} from '../components/HomeCard'
import anperezLogo from '../assets/anperez-logo.png'

// Tela inicial = HUB DE DIRECIONAMENTO (decisão E2.6-A): apresenta a
// identidade do app e navega para os módulos. Os módulos apresentam os
// próprios dados nas suas telas — exceto o card de Contas Correntes que
// mostra saldo real da conta ativa (toggle com patrimônio total).
//
// Visual identity: design tokens extraídos do anperez-mockup-v2.html.
// Tipografia: Space Grotesk (textos) + JetBrains Mono (valores/labels).
// Grade de fundo copper-tinted, radial teal accent, cards em surface.
export default function Dashboard() {
  const navigate = useNavigate()
  const muyEstrecho = useMuyEstrecho()
  const [valoresVisiveis, setValoresVisiveis] = useState(true)
  const [modoContas, setModoContas] = useState('pj')
  const { contaAtiva, contas } = useContaAtiva()
  const { caixinhas: todasCaixinhas } = useTodasCaixinhas()

  const saldoPJ = contaAtiva ? Number(contaAtiva.saldo_atual) : 0
  const patrimonio = contas
    .filter((c) => c.ativa)
    .reduce((soma, c) => soma + Number(c.saldo_atual), 0)
    + todasCaixinhas
      .filter((c) => c.ativa)
      .reduce((soma, c) => soma + Number(c.saldo), 0)

  return (
    <div style={estilos.root}>
      <header style={estilos.brand}>
        <div style={estilos.brandCenter}>
          <img src={anperezLogo} alt="ANPEREZ" style={estilos.brandMark} />
          <div>
            <div style={estilos.brandName}>ANPEREZ MONEY</div>
            <div style={estilos.brandSub}>SEU APP DE GESTÃO FINANCEIRA</div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setValoresVisiveis((v) => !v)}
          style={estilos.eyeIcon}
          aria-label={valoresVisiveis ? 'Ocultar valores' : 'Mostrar valores'}
        >
          {valoresVisiveis ? (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          )}
        </button>
      </header>

      <div style={{
        ...estilos.grid,
        gridTemplateColumns: muyEstrecho ? '1fr' : 'repeat(2, 1fr)',
      }}>
        <HomeCard
          icone={<IconeContas />}
          titulo="Contas Correntes"
          descricao={
            <div>
              <span style={estilos.contaLabel}>
                {modoContas === 'pj' ? `Saldo ${contaAtiva?.nome ?? ''}` : 'Patrimônio total'}
              </span>
              <span style={{
                ...estilos.contaValor,
                filter: valoresVisiveis ? 'none' : 'blur(5px)',
                opacity: valoresVisiveis ? 1 : 0.5,
              }}>
                {formatoReal.format(modoContas === 'pj' ? saldoPJ : patrimonio)}
              </span>
            </div>
          }
          aoClicar={() => navigate('/contas')}
          aoClicarValor={() => setModoContas((m) => m === 'pj' ? 'patrimonio' : 'pj')}
        />
        <HomeCard
          icone={<IconeCartoes />}
          titulo="Cartões de Crédito"
          descricao="Faturas e limites"
          aoClicar={() => navigate('/cartoes')}
          valorVisivel={valoresVisiveis}
        />
        <HomeCard
          icone={<IconePonto />}
          titulo="Ponto Inteligente"
          descricao="Jornada e horas a receber"
          aoClicar={() => navigate('/ponto')}
        />
        <HomeCard
          icone={<IconeRelatorios />}
          titulo="Relatórios"
          descricao="Visão dos seus números"
          aoClicar={() => navigate('/relatorios')}
        />
        <HomeCard
          icone={<IconePlanejamento />}
          titulo="Planejamento"
          descricao="Entradas e despesas futuras"
          aoClicar={() => navigate('/planejamento')}
        />
        <HomeCard
          icone={<IconeConfig />}
          titulo="Configurações"
          descricao="Preferências do app"
          aoClicar={() => navigate('/configuracoes')}
        />
      </div>
    </div>
  )
}

const estilos = {
  root: {
    padding: '1.5rem 1.5rem 3.5rem',
    maxWidth: '720px',
    margin: '0 auto',
    backgroundImage: [
      'radial-gradient(circle at 20% -10%, rgba(63,179,163,0.12), transparent 40%)',
      'linear-gradient(rgba(196,138,86,0.045) 1px, transparent 1px)',
      'linear-gradient(90deg, rgba(196,138,86,0.045) 1px, transparent 1px)',
    ].join(', '),
    backgroundSize: '100% 100%, 22px 22px, 22px 22px',
  },
  brand: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginBottom: '14px',
  },
  brandCenter: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  brandMark: {
    width: '38px',
    height: '38px',
    borderRadius: '11px',
    boxShadow: '0 0 0 1px rgba(255,255,255,0.1)',
    display: 'block',
    flexShrink: 0,
  },
  brandName: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: '14.5px',
    fontWeight: 700,
    color: '#f2f0ea',
    letterSpacing: '0.2px',
  },
  brandSub: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '10px',
    fontWeight: 500,
    color: '#e0a877',
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    marginTop: '1px',
  },
  eyeIcon: {
    position: 'absolute',
    right: 0,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    color: '#a9bdb8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contaLabel: {
    display: 'block',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '9px',
    fontWeight: 500,
    color: '#a9bdb8',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    marginBottom: '2px',
  },
  contaValor: {
    display: 'block',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '10.5px',
    fontWeight: 500,
    color: '#5c6a68',
    transition: 'filter 0.2s, opacity 0.2s',
  },
  grid: {
    display: 'grid',
    gap: '10px',
  },
}
