import { useNavigate } from 'react-router-dom'
import { useMuyEstrecho } from '../hooks/useMediaQuery'
import { estilosComuns } from '../lib/compartilhados'
import HomeCard, {
  IconeContas,
  IconeCartoes,
  IconeRelatorios,
  IconePonto,
  IconePlanejamento,
  IconeConfig,
} from '../components/HomeCard'
import logo from '../assets/logo.png'

// Tela inicial = HUB DE DIRECIONAMENTO (decisão E2.6-A): apresenta a
// identidade do app e navega para os módulos. NÃO consulta dados de
// nenhum módulo — sem resumos financeiros, sem hooks de domínio, sem
// valores. Os módulos apresentam os próprios dados nas suas telas.
//
// Ordem aprovada: Contas, Cartões | Ponto, Relatórios | Planejamento,
// Configurações. Desde a E4 a rota /planejamento existe, então o card
// Planejamento é um direcionador ativo como os demais.
//
// Caixinhas saiu da Home (Opção B da auditoria E2.6-A): caixinha pertence
// a uma conta; o caminho canônico é Contas → lista/detalhe/criação. A
// rota /caixinhas permanece no app (URL, histórico e "← Voltar" do
// detalhe), apenas sem atalho na Home.
//
// Patrimônio Total segue fora da tela inicial (E2.5/E2.6): vive no
// "Resumo do mês" da aba Contas Correntes.
export default function Dashboard() {
  const navigate = useNavigate()
  const muyEstrecho = useMuyEstrecho()

  return (
    <div style={estilosComuns.conteudo}>
      <header style={estilos.cabecalho}>
        <img src={logo} alt="ANPEREZ Money" style={estilos.logo} />
        <h1 style={estilos.saudacao}>ANPEREZ MONEY!</h1>
        <p style={estilos.subtitulo}>
          Seu Aplicativo de Gestão Financeira.
        </p>
      </header>

      <div style={{ ...estilos.grid, gridTemplateColumns: muyEstrecho ? '1fr' : estilos.grid.gridTemplateColumns }}>
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
  cabecalho: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: '0.4rem',
    marginBottom: '1.75rem',
    paddingTop: '0.25rem',
  },
  logo: {
    width: '84px',
    height: '84px',
    borderRadius: '20px',
    marginBottom: '0.75rem',
  },
  saudacao: { margin: 0, fontSize: '1.4rem', fontWeight: 'bold', color: '#e5e7eb' },
  subtitulo: { margin: 0, color: '#9ca3af', fontSize: '0.9rem' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '0.85rem',
  },
}
