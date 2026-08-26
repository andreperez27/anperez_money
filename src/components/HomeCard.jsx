// Card reutilizável da Home (mobile-first). Recebe um ícone (React node),
// título, descrição opcional e a ação de clique. Quando "desabilitado" é
// true, o card fica esmaecido com o selo "Em breve" e não responde a clique.
// "valorVisivel" controla blur+opacity na descrição (toggle de valores).
// "aoClicarValor" cria uma zona de clique separada na descrição (stopPropagation)
// para alternar o modo de exibição sem navegar.
//
// Ícones: SVGs inline (linhas finas, mesmo estilo visual) — o projeto ainda
// não tem biblioteca de ícones, e cada ícone aqui é usado uma única vez,
// então uma dependência nova não se justifica neste momento.
export default function HomeCard({ icone, titulo, descricao, aoClicar, desabilitado, valorVisivel = true, aoClicarValor }) {
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

  const estiloDescricao = aoClicarValor
    ? estilos.descricao
    : { ...estilos.descricao, filter: valorVisivel ? 'none' : 'blur(5px)', opacity: valorVisivel ? 1 : 0.5 }

  return (
    <button type="button" onClick={aoClicar} style={estilos.card}>
      <div style={estilos.icone}>{icone}</div>
      <div>
        <div style={estilos.rotulo}>{titulo}</div>
        {descricao && (
          aoClicarValor ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); aoClicarValor() }}
              style={estilos.botaoDescricao}
            >
              {descricao}
            </button>
          ) : (
            <p style={estiloDescricao}>{descricao}</p>
          )
        )}
      </div>
    </button>
  )
}

const estilos = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '11px',
    alignItems: 'flex-start',
    textAlign: 'left',
    background: '#f4f2ec',
    border: 'none',
    borderRadius: '16px',
    padding: '17px 15px',
    minHeight: '106px',
    cursor: 'pointer',
    fontFamily: "'Space Grotesk', sans-serif",
    width: '100%',
  },
  cardDesabilitado: {
    display: 'flex',
    flexDirection: 'column',
    gap: '11px',
    alignItems: 'flex-start',
    background: '#f4f2ec',
    border: 'none',
    borderRadius: '16px',
    padding: '17px 15px',
    minHeight: '106px',
    opacity: 0.55,
    cursor: 'not-allowed',
    width: '100%',
  },
  icone: {
    width: '30px',
    height: '30px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#e7e2d6',
    color: '#12181a',
  },
  rotulo: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 600,
    fontSize: '13.5px',
    color: '#12181a',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    flexWrap: 'wrap',
  },
  seloEmBreve: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '8.5px',
    fontWeight: 500,
    letterSpacing: '0.08em',
    color: '#1a1108',
    background: '#c07a45',
    borderRadius: '5px',
    padding: '2px 6px',
  },
  descricao: {
    margin: '2px 0 0',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '10.5px',
    fontWeight: 500,
    color: '#5c6a68',
    lineHeight: 1.35,
    transition: 'filter 0.2s, opacity 0.2s',
  },
  botaoDescricao: {
    display: 'block',
    margin: '2px 0 0',
    padding: 0,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '10.5px',
    fontWeight: 500,
    color: '#5c6a68',
    lineHeight: 1.35,
    textAlign: 'left',
    width: '100%',
  },
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
