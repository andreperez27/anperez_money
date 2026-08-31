import { formatarData } from '../../lib/compartilhados'
import { TIPOS_DE_PERIODO } from '../../lib/periodos'
import { rotuloTitulo } from './comum'

// ============================================================================
// SELETOR DE PERÍODO DO PLANEJAMENTO (ETAPA 06/E5-F4)
// ============================================================================
// Componente APRESENTACIONAL: não sabe buscar dados nem faz aritmética de
// datas — quem decide o período é a página (via periodos.js:
// definirPeriodo/deslocarPeriodo/ehPeriodoAtual). Aqui só pílulas de tipo,
// navegação ‹ › e botão Hoje, reutilizando a linguagem visual existente.
// ============================================================================

const RÓTULO_UNIDADE = {
  semana: 'Semana',
  mes: 'Mês',
  trimestre: 'Trimestre',
  semestre: 'Semestre',
  ano: 'Ano',
}

export default function SeletorPeriodo({
  tipo,
  periodo,
  unidadeAtual,
  desabilitado,
  aoTrocarTipo,
  aoDeslocar,
  aoIrParaHoje,
}) {
  const unidade = RÓTULO_UNIDADE[tipo] ?? 'Período'

  return (
    <div style={estilos.bloco}>
      {/* Pílulas de tipo — mesma linguagem visual dos toggles existentes */}
      <div style={estilos.pilulas}>
        {TIPOS_DE_PERIODO.map((t) => (
          <button
            key={t}
            type="button"
            disabled={desabilitado}
            onClick={() => aoTrocarTipo(t)}
            aria-pressed={t === tipo}
            style={{ ...estilos.pilula, ...(t === tipo ? estilos.pilulaAtiva : {}) }}
          >
            {RÓTULO_UNIDADE[t]}
          </button>
        ))}
      </div>

      {/* Navegação do período — ‹ rótulo › + Hoje */}
      <div style={estilos.seletor}>
        <button
          type="button"
          onClick={() => aoDeslocar(-1)}
          disabled={desabilitado}
          aria-label={`${unidade} anterior`}
          title={`${unidade} anterior`}
          style={estilos.seta}
        >
          ‹
        </button>
        <div style={estilos.rotulo}>
          <strong style={estilos.titulo}>{rotuloTitulo(periodo)}</strong>
          {periodo && (
            <span style={estilos.faixa}>
              {formatarData(periodo.inicio)} – {formatarData(periodo.fim)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => aoDeslocar(1)}
          disabled={desabilitado}
          aria-label={`${unidade} seguinte`}
          title={`${unidade} seguinte`}
          style={estilos.seta}
        >
          ›
        </button>
        <button
          type="button"
          onClick={aoIrParaHoje}
          disabled={desabilitado || unidadeAtual}
          style={{ ...estilos.hoje, ...(unidadeAtual ? estilos.hojeAtivo : {}) }}
        >
          Hoje
        </button>
      </div>
    </div>
  )
}

const estilos = {
  bloco: { marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  pilulas: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' },
  pilula: {
    padding: '0.35rem 0.9rem',
    borderRadius: '999px',
    border: '1px solid #374151',
    background: 'transparent',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '0.85rem',
  },
  pilulaAtiva: { color: '#42A5F5', borderColor: 'rgba(66, 165, 245, 0.45)' },
  seletor: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' },
  seta: { width: '36px', height: '36px', borderRadius: '8px', border: '1px solid #374151', background: '#111827', color: '#e5e7eb', fontSize: '1.2rem', lineHeight: 1, cursor: 'pointer' },
  rotulo: { display: 'flex', flexDirection: 'column', minWidth: '150px', gap: '0.1rem' },
  titulo: { color: '#e5e7eb', fontSize: '0.95rem' },
  faixa: { color: '#9ca3af', fontSize: '0.8rem' },
  hoje: { marginLeft: 'auto', padding: '0.35rem 0.9rem', borderRadius: '999px', border: '1px solid #374151', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: '0.85rem' },
  hojeAtivo: { color: '#42A5F5', borderColor: 'rgba(66, 165, 245, 0.45)' },
}
