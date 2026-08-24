// Card reutilizável da Home (mobile-first). Recebe um ícone (React node),
// título, descrição opcional e a ação de clique. Quando "desabilitado" é
// true, o card fica esmaecido com o selo "Em breve" e não responde a clique.
//
// Ícones: SVGs inline (linhas finas, mesmo estilo visual) — o projeto ainda
// não tem biblioteca de ícones, e cada ícone aqui é usado uma única vez,
// então uma dependência nova não se justifica neste momento.
export default function HomeCard({ icone, titulo, descricao, aoClicar, desabilitado }) {
  if (desabilitado) {
    return (
      <div style={estilos.cardDesabilitado}>
        <div style={estilos.icone}>{icone}</div>
        <div>
          <div style={estilos.rotulo}>
            {titulo}
            <span style={estilos.seloEmBreve}>Em breve</span>
          </div>
          {descricao && <p style={estilos.descricao}>{descricao}</p>}
        </div>
      </div>
    )
  }

  return (
    <button type="button" onClick={aoClicar} style={estilos.card}>
      <div style={estilos.icone}>{icone}</div>
      <div>
        <div style={estilos.rotulo}>{titulo}</div>
        {descricao && <p style={estilos.descricao}>{descricao}</p>}
      </div>
    </button>
  )
}

const estilos = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    alignItems: 'flex-start',
    textAlign: 'left',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '16px',
    padding: '1rem',
    cursor: 'pointer',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)',
    fontFamily: 'inherit',
    width: '100%',
  },
  cardDesabilitado: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    alignItems: 'flex-start',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '16px',
    padding: '1rem',
    opacity: 0.55,
    cursor: 'not-allowed',
    width: '100%',
  },
  icone: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#e8f4fd',
    color: '#2f7dc4',
  },
  rotulo: {
    fontWeight: 'bold',
    fontSize: '0.95rem',
    color: '#111827',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    flexWrap: 'wrap',
  },
  seloEmBreve: {
    fontSize: '0.65rem',
    fontWeight: 'bold',
    color: '#6b7280',
    background: '#f3f4f6',
    border: '1px solid #e5e7eb',
    borderRadius: '999px',
    padding: '0.1rem 0.5rem',
  },
  descricao: { margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#6b7280' },
}

// ---------------------------------------------------------------------------
// Ícones (SVG inline, 24x24, traço atual com cor). Todos aceitam "cor"
// opcional para reaproveitamento (ex.: bottom navigation).
// ---------------------------------------------------------------------------

function Svg({ children, cor = 'currentColor' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke={cor}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

// Banco/clássico de conta corrente: frontão com colunas.
export function IconeContas() {
  return (
    <Svg>
      <path d="M3 21h18" />
      <path d="M4 21V10l8-6 8 6v11" />
      <path d="M9 21v-6h6v6" />
    </Svg>
  )
}

// Cartão de crédito: retângulo com faixa magnética.
export function IconeCartoes() {
  return (
    <Svg>
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <path d="M2 10h20" />
      <path d="M6 15h4" />
    </Svg>
  )
}

// Caixinha: "poupança" com pilha de moedas.
export function IconeCaixinhas() {
  return (
    <Svg>
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </Svg>
  )
}

// Relatórios: gráfico de barras.
export function IconeRelatorios() {
  return (
    <Svg>
      <path d="M3 3v18h18" />
      <path d="M7 15v-4" />
      <path d="M12 15V7" />
      <path d="M17 15v-6" />
    </Svg>
  )
}

// Ponto Inteligente: relógio.
export function IconePonto() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  )
}

// Planejamento: calendário (entradas/despesas futuras por semana).
export function IconePlanejamento() {
  return (
    <Svg>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M3 10h18" />
      <path d="M9 15l2 2 4-4" />
    </Svg>
  )
}

// Configurações: sliders (linhas com botões de ajuste).
export function IconeConfig() {
  return (
    <Svg>
      <path d="M4 6h10" />
      <path d="M18 6h2" />
      <circle cx="16" cy="6" r="2" />
      <path d="M4 12h2" />
      <path d="M10 12h10" />
      <circle cx="8" cy="12" r="2" />
      <path d="M4 18h10" />
      <path d="M18 18h2" />
      <circle cx="16" cy="18" r="2" />
    </Svg>
  )
}