import { Link } from 'react-router-dom'
import { useContaAtiva } from '../context/ContaAtivaContext'
import { useCaixinhas } from '../hooks/useCaixinhas'
import { estilosComuns, formatoReal } from '../lib/compartilhados'

// Lista das caixinhas da CONTA ATIVA: cada card mostra nome + saldo e é
// clicável, navegando para a tela de detalhe (/caixinhas/:id). Trocou a
// conta ativa no cabeçalho, a lista recarrega sozinha (useCaixinhas
// reexecuta por contaId).
export default function Caixinhas() {
  const { contaAtiva, contas, carregando: contasCarregando } = useContaAtiva()
  const { caixinhas, carregando, erro } = useCaixinhas(contaAtiva?.id)

  return (
    <div style={estilosComuns.conteudo}>
      <h2 style={{ margin: '0 0 0.75rem' }}>
        Caixinhas{contaAtiva ? ` · ${contaAtiva.nome}` : ''}
      </h2>

      {contasCarregando && <p style={estilosComuns.mensagem}>Carregando contas...</p>}

      {!contasCarregando && contas.length === 0 && (
        <div>
          <p style={estilosComuns.mensagem}>
            Cadastre uma conta primeiro para criar caixinhas.
          </p>
          <Link to="/contas" style={estilosComuns.link}>Ir para Contas</Link>
        </div>
      )}

      {!contasCarregando && contas.length > 0 && carregando && (
        <p style={estilosComuns.mensagem}>Carregando caixinhas...</p>
      )}

      {!contasCarregando && contas.length > 0 && erro && (
        <p style={estilosComuns.erro}>Não foi possível carregar as caixinhas: {erro}</p>
      )}

      {!contasCarregando && contas.length > 0 && !carregando && !erro && caixinhas.length === 0 && (
        <p style={estilosComuns.mensagem}>
          Nenhuma caixinha nesta conta. Crie uma em Contas Correntes.
        </p>
      )}

      {!contasCarregando && contas.length > 0 && !carregando && !erro && caixinhas.length > 0 && (
        <div style={estilos.grupo}>
          {caixinhas.map((caixinha) => (
            <Link key={caixinha.id} to={`/caixinhas/${caixinha.id}`} style={estilos.card}>
              <span style={estilos.nome}>{caixinha.nome}</span>
              <strong style={estilos.saldo}>{formatoReal.format(Number(caixinha.saldo))}</strong>
              {caixinha.objetivo ? (
                <span style={estilos.meta}>meta {formatoReal.format(Number(caixinha.objetivo))}</span>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

const estilos = {
  grupo: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' },
  card: {
    flex: '1 1 140px',
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: '12px',
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '0.3rem',
    textDecoration: 'none',
    color: '#e5e7eb',
    cursor: 'pointer',
  },
  nome: { fontWeight: 'bold' },
  saldo: { color: '#42A5F5', fontSize: '1.05rem' },
  meta: { color: '#6b7280', fontSize: '0.8rem' },
}