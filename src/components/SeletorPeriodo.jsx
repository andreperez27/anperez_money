import { estilosComuns } from '../lib/compartilhados'

// Seletor de período do extrato, no estilo do app antigo: pílulas com
// os períodos prontos e, em "Personalizado", dois inputs de data.
// O estado vive na página (Movimentacoes); aqui só o visual + os
// callbacks.
const OPCOES = [
  { valor: 'ultimos10', rotulo: 'Últimos 10' },
  { valor: 'mesAtual', rotulo: 'Mês atual' },
  { valor: 'mesAnterior', rotulo: 'Mês anterior' },
  { valor: 'personalizado', rotulo: 'Personalizado' },
]

export default function SeletorPeriodo({
  valor,
  aoTrocarPeriodo,
  dataInicio,
  dataFim,
  aoTrocarDataInicio,
  aoTrocarDataFim,
}) {
  return (
    <div>
      <div style={estilos.grupo}>
        {OPCOES.map((opcao) => {
          const ativa = valor === opcao.valor
          return (
            <button
              key={opcao.valor}
              type="button"
              onClick={() => aoTrocarPeriodo(opcao.valor)}
              style={ativa ? estilos.pilhaAtiva : estilos.pilha}
              aria-pressed={ativa}
            >
              {opcao.rotulo}
            </button>
          )
        })}
      </div>

      {valor === 'personalizado' && (
        <div style={estilos.datas}>
          <label style={estilos.rotuloData}>
            De
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => aoTrocarDataInicio(e.target.value)}
              style={{ ...estilosComuns.input, minWidth: 0, flex: 1 }}
            />
          </label>
          <label style={estilos.rotuloData}>
            Até
            <input
              type="date"
              value={dataFim}
              onChange={(e) => aoTrocarDataFim(e.target.value)}
              style={{ ...estilosComuns.input, minWidth: 0, flex: 1 }}
            />
          </label>
        </div>
      )}
    </div>
  )
}

const estilos = {
  grupo: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' },
  pilha: {
    padding: '0.35rem 0.7rem',
    borderRadius: '999px',
    border: '1px solid #374151',
    background: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontFamily: 'inherit',
  },
  pilhaAtiva: {
    padding: '0.35rem 0.7rem',
    borderRadius: '999px',
    border: '1px solid #42A5F5',
    background: '#42A5F5',
    color: '#0b0f19',
    cursor: 'pointer',
    fontSize: '0.8rem',
    fontWeight: 'bold',
    fontFamily: 'inherit',
  },
  datas: { display: 'flex', gap: '0.6rem', marginTop: '0.6rem' },
  rotuloData: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    flex: 1,
    fontSize: '0.75rem',
    color: '#9ca3af',
  },
}