import { Link, useNavigate } from 'react-router-dom'
import { useContas } from '../hooks/useContas'
import { useTodasCaixinhas } from '../hooks/useCaixinhas'
import { formatoReal } from '../lib/compartilhados'
import CaberNaTela from '../components/CaberNaTela'
import logo from '../assets/logo.png'
import HomeCard, {
  IconeContas,
  IconeCartoes,
  IconeCaixinhas,
  IconeRelatorios,
  IconePonto,
  IconeConfig,
} from '../components/HomeCard'

// Tela inicial (mobile-first): cartão de entrada do app, em fundo claro,
// com o logo, a saudação e o grid de atalhos. A navegação principal vive
// no menu do cabeçalho (Início | Contas Correntes | Cartões |
// Configurações) e aqui no grid.
//
// O card mostra o PATRIMÔNIO TOTAL = soma dos saldos de todas as contas
// ativas + todas as caixinhas ativas. As buscas são feitas com hooks
// LOCAIS desta página (useContas + useTodasCaixinhas) em vez do contexto
// de conta ativa, para que a navegação até aqui sempre traga o valor
// mais recente do banco.
export default function Dashboard() {
  const navigate = useNavigate()
  const {
    contas,
    carregando: contasCarregando,
    erro: contasErro,
  } = useContas()
  const {
    caixinhas,
    carregando: caixinhasCarregando,
    erro: caixinhasErro,
  } = useTodasCaixinhas()

  const contasAtivas = contas.filter((c) => c.ativa)
  const caixinhasAtivas = caixinhas.filter((cx) => cx.ativa)
  const patrimonio =
    contasAtivas.reduce((soma, c) => soma + Number(c.saldo_atual || 0), 0) +
    caixinhasAtivas.reduce((soma, cx) => soma + Number(cx.saldo || 0), 0)
  const carregando = contasCarregando || caixinhasCarregando
  const temAlgo = contasAtivas.length > 0 || caixinhasAtivas.length > 0

  function resumoPatrimonio() {
    const partes = []
    if (contasAtivas.length > 0) {
      partes.push(`${contasAtivas.length} ${contasAtivas.length === 1 ? 'conta' : 'contas'}`)
    }
    if (caixinhasAtivas.length > 0) {
      partes.push(`${caixinhasAtivas.length} ${caixinhasAtivas.length === 1 ? 'caixinha' : 'caixinhas'}`)
    }
    return partes.join(' · ')
  }

  return (
    <div className="tela-inteira" style={estilos.pagina}>
      <CaberNaTela maxLargura={480}>
        <div style={estilos.corpo}>
          <header style={estilos.cabecalho}>
          <img src={logo} alt="ANPEREZ Money" style={estilos.logo} />
          <h1 style={estilos.saudacao}>Bem-vindo ao ANPEREZ!</h1>
          <p style={estilos.subtitulo}>
            Sua jornada financeira e de gestão começa aqui.
          </p>
        </header>

        {/* Cartão do patrimônio: toque nele abre Contas e Caixinhas
            (/contas). Busca local = sempre o valor mais recente. */}
        {carregando && (
          <div style={estilos.cartaoSaldo}>
            <span style={estilos.cartaoRotulo}>Carregando patrimônio...</span>
          </div>
        )}

        {!carregando && temAlgo && (
          <Link to="/contas" style={estilos.cartaoSaldo}>
            <div>
              <span style={estilos.cartaoRotulo}>Patrimônio total</span>
              <strong style={estilos.cartaoValor}>
                {formatoReal.format(patrimonio)}
              </strong>
              <span style={estilos.cartaoAcao}>{resumoPatrimonio()} · ver detalhes</span>
            </div>
            <span style={estilos.cartaoSeta} aria-hidden="true">›</span>
          </Link>
        )}

        {!carregando && !temAlgo && (contasErro || caixinhasErro) && (
          <div style={estilos.cartaoSaldo}>
            <span style={estilos.cartaoRotulo}>Não foi possível carregar o patrimônio</span>
          </div>
        )}

        {!carregando && !temAlgo && !contasErro && !caixinhasErro && (
          <Link to="/configuracoes" style={estilos.cartaoSaldo}>
            <div>
              <span style={estilos.cartaoRotulo}>Nenhuma conta cadastrada</span>
              <strong style={estilos.cartaoValor}>Cadastre sua primeira conta</strong>
              <span style={estilos.cartaoAcao}>Ir para Configurações</span>
            </div>
            <span style={estilos.cartaoSeta} aria-hidden="true">›</span>
          </Link>
        )}

        <div style={estilos.grid}>
          <HomeCard
            icone={<IconeContas />}
            titulo="Contas Correntes"
            descricao="Saldos e movimentações"
            aoClicar={() => navigate('/contas')}
          />
          <HomeCard
            icone={<IconeCartoes />}
            titulo="Cartões de Crédito"
            descricao="Faturas e limites"
            aoClicar={() => navigate('/cartoes')}
          />
          <HomeCard
            icone={<IconeCaixinhas />}
            titulo="Caixinhas"
            descricao="Reservas e objetivos"
            aoClicar={() => navigate('/caixinhas')}
          />
          <HomeCard
            icone={<IconeRelatorios />}
            titulo="Relatórios"
            descricao="Visão dos seus números"
            aoClicar={() => navigate('/relatorios')}
          />
          <HomeCard
            icone={<IconePonto />}
            titulo="Ponto Inteligente"
            descricao="Jornada e horas a receber"
            aoClicar={() => navigate('/ponto')}
          />
          <HomeCard
            icone={<IconeConfig />}
            titulo="Configurações"
            descricao="Preferências do app"
            aoClicar={() => navigate('/configuracoes')}
          />
          </div>
        </div>
      </CaberNaTela>
    </div>
  )
}

const estilos = {
  pagina: {
    background: '#f6f7f9',
    color: '#111827',
    fontFamily: 'sans-serif',
    // Base levemente maior que o padrão (16px): a tela inicial respira
    // melhor e o CaberNaTela encolhe/amplia conforme a altura real.
    fontSize: '1.05rem',
  },
  corpo: {
    width: '100%',
    maxWidth: '480px',
    padding: '1rem 1rem 0.5rem',
  },
  cabecalho: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: '0.4rem',
    marginBottom: '1.75rem',
    paddingTop: '1rem',
  },
  logo: {
    width: '84px',
    height: '84px',
    borderRadius: '20px',
    marginBottom: '0.75rem',
    boxShadow: '0 4px 14px rgba(15, 23, 42, 0.12)',
  },
  saudacao: { margin: 0, fontSize: '1.4rem', fontWeight: 'bold' },
  subtitulo: { margin: 0, color: '#6b7280', fontSize: '0.9rem' },
  cartaoSaldo: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '16px',
    padding: '1rem 1.1rem',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)',
    textDecoration: 'none',
    color: 'inherit',
    gap: '0.5rem',
    marginBottom: '1.25rem',
  },
  cartaoRotulo: {
    display: 'block',
    fontSize: '0.8rem',
    color: '#6b7280',
  },
  cartaoValor: {
    display: 'block',
    fontSize: '1.35rem',
    color: '#111827',
    margin: '0.1rem 0 0.15rem',
  },
  cartaoAcao: {
    display: 'block',
    fontSize: '0.75rem',
    color: '#2f7dc4',
  },
  cartaoSeta: { fontSize: '1.6rem', color: '#9ca3af' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '0.85rem',
  },
}