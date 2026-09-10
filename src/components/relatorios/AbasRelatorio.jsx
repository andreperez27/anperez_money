// ============================================================================
// ABAS DOS RELATÓRIOS
// ============================================================================
// Pílulas roláveis horizontalmente (mesma linguagem visual das abas de
// Configurações e do detalhe do Cartão, com a ativa preenchida em #42A5F5).
// A ordem é fixa: Recebido & horas, Acordo trabalhista, Patrimônio, Entradas
// x despesas, Por categoria, Cartões, Planejado x real. Trocar de aba NÃO
// reseta o período — quem guarda o período é a página; este componente só
// comunica qual aba está selecionada.
// ============================================================================

const ABAS = [
  { chave: 'recebido-horas', rotulo: 'Recebido & horas' },
  { chave: 'acordo-trabalhista', rotulo: 'Acordo trabalhista' },
  { chave: 'patrimonio', rotulo: 'Patrimônio' },
  { chave: 'entradas-x-despesas', rotulo: 'Entradas x despesas' },
  { chave: 'por-categoria', rotulo: 'Por categoria' },
  { chave: 'cartoes', rotulo: 'Cartões' },
  { chave: 'planejado-x-real', rotulo: 'Planejado x real' },
]

export default function AbasRelatorio({ aba, aoTrocarAba }) {
  return (
    <div style={estilos.lista} role="tablist" aria-label="Tópicos do relatório">
      {ABAS.map((a) => {
        const ativa = a.chave === aba
        return (
          <button
            key={a.chave}
            type="button"
            role="tab"
            aria-selected={ativa}
            onClick={() => aoTrocarAba(a.chave)}
            style={{ ...estilos.aba, ...(ativa ? estilos.abaAtiva : {}) }}
          >
            {a.rotulo}
          </button>
        )
      })}
    </div>
  )
}

const estilos = {
  lista: {
    display: 'flex',
    gap: '0.5rem',
    overflowX: 'auto',
    paddingBottom: '0.4rem',
    marginBottom: '1.25rem',
    borderBottom: '1px solid #1f2937',
    WebkitOverflowScrolling: 'touch',
  },
  aba: {
    flexShrink: 0,
    padding: '0.5rem 1rem',
    borderRadius: '999px',
    border: '1px solid #1f2937',
    background: '#111827',
    color: '#6b7280',
    fontSize: '0.9rem',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  abaAtiva: {
    flexShrink: 0,
    padding: '0.5rem 1rem',
    borderRadius: '999px',
    border: '1px solid #42A5F5',
    background: '#1f2937',
    color: '#42A5F5',
    fontSize: '0.9rem',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
  },
}