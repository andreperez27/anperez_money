// ============================================================================
// SELETOR DE PERÍODO DOS RELATÓRIOS
// ============================================================================
// Componente APRESENTACIONAL: não faz aritmética de datas — quem decide o
// período é a página (via periodos.js: definirPeriodo/deslocarPeriodo/
// definirPeriodoPersonalizado). Aqui só pílulas de tipo e navegação ‹ ›,
// reutilizando a linguagem visual do SeletorPeriodo do Planejamento (Mês,
// Trimestre, Semestre e Ano) e acrescentando o Personalizado — que troca a
// navegação ‹ › por dois campos de data (De/Até).
// ============================================================================
import { formatarData } from '../../lib/compartilhados'
import { NOME_MES, MES_ABREV } from '../planejamento/comum'

// A ordem da tela: Semana, Mês, Trimestre, Semestre, Ano, Personalizado.
const TIPOS = ['semana', 'mes', 'trimestre', 'semestre', 'ano', 'personalizado']

const RÓTULO_UNIDADE = {
  semana: 'Semana',
  mes: 'Mês',
  trimestre: 'Trimestre',
  semestre: 'Semestre',
  ano: 'Ano',
  personalizado: 'Personalizado',
}

// Rótulo central do período ativo, no padrão do mockup da página:
//   semana   → "Semana 35 / 2026 · 24/08 – 30/08"
//   trimestre → "2º trimestre / 2026 · abr – jun"
//   semestre  → "2º semestre / 2026 · jul – dez"
//   ano       → "Ano 2026 · jan – dez"
//   mes       → "Agosto / 2026 · 01/08 – 31/08"
//   personalizado → "Personalizado · 01/04/2026 – 30/06/2026"
function rotuloPeriodo(periodo, tipo) {
  if (!periodo) {
    return { titulo: tipo === 'personalizado' ? 'Personalizado' : '', faixa: '' }
  }

  if (periodo.tipo === 'personalizado') {
    return {
      titulo: 'Personalizado',
      faixa: `${formatarData(periodo.inicio)} – ${formatarData(periodo.fim)}`,
    }
  }

  if (periodo.tipo === 'semana') {
    return {
      titulo: `Semana ${periodo.semana} / ${periodo.ano}`,
      faixa: `${formatarData(periodo.inicio)} – ${formatarData(periodo.fim)}`,
    }
  }

  if (periodo.tipo === 'mes') {
    return {
      titulo: `${NOME_MES[periodo.mes - 1]} / ${periodo.ano}`,
      faixa: `${formatarData(periodo.inicio)} – ${formatarData(periodo.fim)}`,
    }
  }

  if (periodo.tipo === 'trimestre') {
    const primeiro = Number(periodo.inicio.slice(5, 7))
    const ultimo = Number(periodo.fim.slice(5, 7))
    return {
      titulo: `${periodo.trimestre}º trimestre / ${periodo.ano}`,
      faixa: `${MES_ABREV[primeiro - 1]} – ${MES_ABREV[ultimo - 1]}`,
    }
  }

  if (periodo.tipo === 'semestre') {
    const primeiro = Number(periodo.inicio.slice(5, 7))
    const ultimo = Number(periodo.fim.slice(5, 7))
    return {
      titulo: `${periodo.semestre}º semestre / ${periodo.ano}`,
      faixa: `${MES_ABREV[primeiro - 1]} – ${MES_ABREV[ultimo - 1]}`,
    }
  }

  if (periodo.tipo === 'ano') {
    return {
      titulo: `Ano ${periodo.ano}`,
      faixa: `${MES_ABREV[0]} – ${MES_ABREV[11]}`,
    }
  }

  return { titulo: periodo.tipo, faixa: '' }
}

export default function SeletorPeriodoRelatorio({
  tipo,
  periodo,
  dataInicio,
  dataFim,
  aoTrocarTipo,
  aoDeslocar,
  aoTrocarDataInicio,
  aoTrocarDataFim,
}) {
  const rotulo = rotuloPeriodo(periodo, tipo)
  const ehPersonalizado = tipo === 'personalizado'

  return (
    <div style={estilos.bloco}>
      {/* Pílulas de tipo */}
      <div style={estilos.pilulas}>
        {TIPOS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => aoTrocarTipo(t)}
            aria-pressed={t === tipo}
            style={{ ...estilos.pilula, ...(t === tipo ? estilos.pilulaAtiva : {}) }}
          >
            {RÓTULO_UNIDADE[t]}
          </button>
        ))}
      </div>

      {ehPersonalizado ? (
        // Período livre: campos De/Até no lugar da navegação ‹ ›.
        <div style={estilos.camposPersonalizado}>
          <label style={estilos.campoData}>
            <span style={estilos.rotuloCampo}>De</span>
            <input
              type="date"
              value={dataInicio ?? ''}
              onChange={(e) => aoTrocarDataInicio(e.target.value)}
              style={estilos.inputData}
            />
          </label>
          <label style={estilos.campoData}>
            <span style={estilos.rotuloCampo}>Até</span>
            <input
              type="date"
              value={dataFim ?? ''}
              onChange={(e) => aoTrocarDataFim(e.target.value)}
              style={estilos.inputData}
            />
          </label>
          <div style={estilos.rotulo}>
            <strong style={estilos.titulo}>{rotulo.titulo}</strong>
            {rotulo.faixa && <span style={estilos.faixa}>{rotulo.faixa}</span>}
          </div>
        </div>
      ) : (
        // Períodos fixos: rótulo central circundado pela navegação ‹ ›.
        <div style={estilos.seletor}>
          <button
            type="button"
            onClick={() => aoDeslocar(-1)}
            aria-label="Período anterior"
            title="Período anterior"
            style={estilos.seta}
          >
            ‹
          </button>
          <div style={estilos.rotulo}>
            <strong style={estilos.titulo}>{rotulo.titulo}</strong>
            {rotulo.faixa && <span style={estilos.faixa}>{rotulo.faixa}</span>}
          </div>
          <button
            type="button"
            onClick={() => aoDeslocar(1)}
            aria-label="Período seguinte"
            title="Período seguinte"
            style={estilos.seta}
          >
            ›
          </button>
        </div>
      )}
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
  seta: {
    width: '36px',
    height: '36px',
    borderRadius: '8px',
    border: '1px solid #374151',
    background: '#111827',
    color: '#e5e7eb',
    fontSize: '1.2rem',
    lineHeight: 1,
    cursor: 'pointer',
  },
  rotulo: { display: 'flex', flexDirection: 'column', minWidth: '150px', gap: '0.1rem' },
  titulo: { color: '#e5e7eb', fontSize: '0.95rem' },
  faixa: { color: '#9ca3af', fontSize: '0.8rem' },
  camposPersonalizado: {
    display: 'flex',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: '0.6rem',
  },
  campoData: { display: 'flex', flexDirection: 'column', gap: '0.15rem' },
  rotuloCampo: { color: '#9ca3af', fontSize: '0.75rem' },
  inputData: {
    padding: '0.4rem 0.6rem',
    borderRadius: '8px',
    border: '1px solid #374151',
    background: '#111827',
    color: '#e5e7eb',
    fontSize: '0.85rem',
    fontFamily: 'inherit',
  },
}