import { useState } from 'react'
import { estilosComuns, hoje } from '../lib/compartilhados'
import {
  definirPeriodo,
  deslocarPeriodo,
  definirPeriodoPersonalizado,
} from '../lib/periodos'
import SeletorPeriodoRelatorio from '../components/relatorios/SeletorPeriodoRelatorio'
import AbasRelatorio from '../components/relatorios/AbasRelatorio'
import RelatorioTemplate from '../components/relatorios/RelatorioTemplate'
import { useRelatorioRecebidoHoras } from '../hooks/useRelatorioRecebidoHoras'
import { useRelatorioAcordo } from '../hooks/useRelatorioAcordo'
import { useRelatorioEntradasDespesas } from '../hooks/useRelatorioEntradasDespesas'

// ============================================================================
// RELATÓRIOS
// ============================================================================
// Orquestrador: seletor de período no topo, abas de tópico abaixo (trocar de
// aba NÃO reseta o período — as duas coisas são estados independentes) e o
// RelatorioTemplate na aba ativa. As abas "Recebido & horas", "Acordo
// trabalhista" e "Entradas x despesas" já buscam dados reais (hooks
// useRelatorioRecebidoHoras, useRelatorioAcordo e useRelatorioEntradasDespesas);
// as restantes ainda recebem as props vazias e o visual fica em "Em
// construção" em cada bloco. O exportar PDF do cabeçalho está desabilitado
// ("em breve"), apenas informativo.
// ============================================================================

const ABA_PADRAO = 'recebido-horas'

export default function Relatorios() {
  const [tipo, setTipo] = useState('mes')
  const [periodoBasico, setPeriodoBasico] = useState(() => definirPeriodo('mes', hoje()))
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [aba, setAba] = useState(ABA_PADRAO)

  // Período efetivo: personalizado só existe quando a faixa De/Até é VÁLIDA
  // (ambas preenchidas e inicio <= fim). Faixa incompleta/invertida mantém o
  // último período válido e a página mostra um aviso (mesmo comportamento do
  // filtro Personalizado do extrato).
  function montarPersonalizado() {
    if (!dataInicio || !dataFim) return null
    try {
      return definirPeriodoPersonalizado(dataInicio, dataFim)
    } catch {
      return null
    }
  }
  const periodo = tipo === 'personalizado' ? montarPersonalizado() : periodoBasico

  function aoTrocarTipo(novoTipo) {
    if (novoTipo === 'personalizado') {
      // Herda a faixa do período que estava visível para o usuário já
      // começar com um intervalo coerente (o mesmo do período atual).
      const base = tipo === 'personalizado' ? null : periodoBasico
      setDataInicio(base?.inicio ?? '')
      setDataFim(base?.fim ?? '')
      setTipo(novoTipo)
      return
    }
    // Referência dentro do período atual (o "início" é uma data civil do
    // próprio período, então definir o novo tipo mantém a mesma época).
    const referencia = periodo?.inicio ?? hoje()
    setPeriodoBasico(definirPeriodo(novoTipo, referencia))
    setTipo(novoTipo)
  }

  function aoDeslocar(delta) {
    setPeriodoBasico(deslocarPeriodo(tipo, periodoBasico, delta))
  }

  function aoTrocarDataInicio(valor) {
    setDataInicio(valor)
  }

  function aoTrocarDataFim(valor) {
    setDataFim(valor)
  }

  const faixaInvertida = Boolean(dataInicio && dataFim && dataInicio > dataFim)

  // Aba "Recebido & horas", "Acordo trabalhista" e "Entradas x despesas": dados
  // reais do período. As demais abas continuam sem dados (template em "Em
  // construção"). Os hooks já devolvem as props no formato do RelatorioTemplate.
  const recebidoHoras = useRelatorioRecebidoHoras(periodo ?? undefined)
  const acordo = useRelatorioAcordo(periodo ?? undefined)
  const entradasDespesas = useRelatorioEntradasDespesas(periodo ?? undefined)

  return (
    <div style={estilosComuns.conteudo}>
      {/* Cabeçalho: Relatórios + exportar PDF (em breve, desabilitado). */}
      <header style={estilos.cabecalho}>
        <div>
          <h2 style={estilos.titulo}>Relatórios</h2>
          <p style={estilos.subtitulo}>
            Em breve você analisa seus números por período, categoria e conta.
          </p>
        </div>
        <button type="button" disabled style={estilos.botaoPdf} title="Exportar PDF (em breve)">
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            aria-hidden="true"
            style={{ stroke: 'currentColor', strokeWidth: 2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }}
          >
            <path d="M12 3v12" />
            <path d="M7 10l5 5 5-5" />
            <path d="M4 21h16" />
          </svg>
          <span style={estilos.seloEmBreve}>em breve</span>
        </button>
      </header>

      {/* Seletor de período (Mês/Trimestre/Semestre/Ano/Personalizado) */}
      <SeletorPeriodoRelatorio
        tipo={tipo}
        periodo={periodo}
        dataInicio={dataInicio}
        dataFim={dataFim}
        aoTrocarTipo={aoTrocarTipo}
        aoDeslocar={aoDeslocar}
        aoTrocarDataInicio={aoTrocarDataInicio}
        aoTrocarDataFim={aoTrocarDataFim}
      />

      {faixaInvertida && (
        <p style={estilos.aviso}>
          A data inicial deve ser anterior ou igual à final. Ajuste o período
          para ver o relatório.
        </p>
      )}

      {/* Abas de tópico — não resetam o período selecionado. */}
      <AbasRelatorio aba={aba} aoTrocarAba={setAba} />

      {aba === 'recebido-horas' ? (
        recebidoHoras.erro ? (
          <p style={estilos.erro}>{recebidoHoras.erro}</p>
        ) : (
          <RelatorioTemplate
            cards={recebidoHoras.cards}
            grafico={recebidoHoras.grafico}
            linhas={recebidoHoras.linhas}
          />
        )
      ) : aba === 'acordo-trabalhista' ? (
        acordo.erro ? (
          <p style={estilos.erro}>{acordo.erro}</p>
        ) : (
          <RelatorioTemplate
            cards={acordo.cards}
            grafico={acordo.grafico}
            linhas={acordo.linhas}
          />
        )
      ) : aba === 'entradas-x-despesas' ? (
        entradasDespesas.erro ? (
          <p style={estilos.erro}>{entradasDespesas.erro}</p>
        ) : (
          <RelatorioTemplate
            cards={entradasDespesas.cards}
            grafico={entradasDespesas.grafico}
            linhas={entradasDespesas.linhas}
          />
        )
      ) : (
        /* Demais abas: mesmo template sem dados reais por enquanto. */
        <RelatorioTemplate />
      )}
    </div>
  )
}

const estilos = {
  cabecalho: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem',
    marginBottom: '1.25rem',
  },
  titulo: { margin: 0, fontSize: '1.3rem', fontWeight: 'bold', color: '#e5e7eb' },
  subtitulo: { margin: '0.25rem 0 0', color: '#9ca3af', fontSize: '0.9rem' },
  botaoPdf: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.5rem 0.9rem',
    borderRadius: '10px',
    border: '1px solid #374151',
    background: '#111827',
    color: '#9ca3af',
    cursor: 'not-allowed',
    opacity: 0.6,
    fontWeight: 500,
    fontSize: '0.85rem',
    fontFamily: 'inherit',
  },
  seloEmBreve: {
    fontSize: '0.7rem',
    fontWeight: 'bold',
    border: '1px dashed #4b5563',
    borderRadius: '999px',
    padding: '0.15rem 0.6rem',
    whiteSpace: 'nowrap',
  },
  aviso: { margin: '0 0 0.75rem', color: '#f87171', fontSize: '0.8rem' },
  erro: { margin: '0.75rem 0 0', color: '#ef4444', fontSize: '0.85rem' },
}