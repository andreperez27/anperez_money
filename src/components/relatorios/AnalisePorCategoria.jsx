// ============================================================================
// ABA "POR CATEGORIA" (Relatórios)
// ============================================================================
// Busca/análise por categoria no período selecionado (mesmo
// SeletorPeriodoRelatorio da página). Reusa a FONTE ÚNICA de categorização do
// relatório (src/lib/relatorioPdf.js), via o orquestrador
// montarDadosAbaCategoria:
//   - seleção = TODAS_CATEGORIAS (padrão) → visão 'resumo': ranking geral de
//     gastos "Gasto por categoria no período" (clicável);
//   - seleção = categoria específica OU "Sem categoria" ('' ) → visão
//     'detalhe': o total + a lista de lançamentos TRANÇAM PARA o TOPO, logo
//     abaixo do seletor — o ranking fica RECOLHIDO atrás de um botão "Ver todas
//     as categorias" clicável (UX 10/09/2026). Sem seleção, o padrão mostra o
//     ranking normalmente.
// Não duplica regra de categorização nenhuma: o componente só faz render e
// delega o fetch ao hook useAnaliseCategoria.
// ============================================================================

import { useMemo, useState } from 'react'
import { estilosComuns, formatoReal, formatarData } from '../../lib/compartilhados'
import { montarDadosAbaCategoria, TODAS_CATEGORIAS } from '../../lib/relatorioPdf'
import { useAnaliseCategoria } from '../../hooks/useAnaliseCategoria'
import SeletorCategoria from '../SeletorCategoria'

const COR_PRINCIPAL = '#42A5F5'
const COR_AZUL_ESMAECIDO = 'rgba(66, 165, 245, 0.35)'
const COR_TEXTO_FORTE = '#e5e7eb'
const COR_TEXTO_SUAVE = '#9ca3af'
const COR_MOVIMENTACAO = '#22C55E'
const COR_COMPRA = '#F59E0B'

const ROTULO_DETALHE = {
  '': 'Lançamentos sem categoria',
  [TODAS_CATEGORIAS]: '',
}

// --------------------------------------------------------------------------
// GRÁFICO COMPARATIVO DE CATEGORIAS — barras horizontais proporcionais (CSS
// puro, padrão do app — RelatorioTemplate; sem biblioteca).
// Sempre visível quando há dados (mesmo com categoria selecionada, como
// contexto). Fonte: resumo.linhas (o MESMO array do ranking — nenhum cálculo
// duplicado). Destaque (decisão 12/09/2026): categoria selecionada em
// #42A5F5 SÓLIDO (o tom "ativo" do app — conta ativa, aba ativa, pílula do
// seletor) e as demais esmaecidas; sem seleção todas iguais.
// Cada linha é CLICÁVEL = mesma ação do dropdown (aoClicarBarra); clicar na
// categoria já selecionada volta para "todas" (toggle só aqui — decisão
// 12/09/2026; dropdown e ranking intactos). Hover sutil por linha (estado
// local), igual ao cursor padrão dos demais clicáveis do app.
// Aditivo: sem dados ou erro → só o gráfico some; a lista segue normal.
// ==========================================================================
function LinhaComparativa({ linha, largura, ativa, esmaecida, aoClicarBarra }) {
  const [hover, setHover] = useState(false)

  return (
    <button
      type="button"
      onClick={() => aoClicarBarra(linha)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`Ver os lançamentos de ${linha.categoria}`}
      style={{
        ...estilos.linhaGrafico,
        ...(ativa ? estilos.linhaGraficoAtiva : {}),
        ...(hover ? estilos.linhaGraficoHover : {}),
      }}
    >
      <span style={estilos.nomeGrafico} title={linha.categoria}>
        {linha.categoria}
      </span>
      <span style={estilos.trilha}>
        <span
          style={{
            ...estilos.barra,
            width: `${largura}%`,
            background: ativa
              ? COR_PRINCIPAL
              : esmaecida
                ? COR_AZUL_ESMAECIDO
                : COR_PRINCIPAL,
            ...(hover ? estilos.barraHover : {}),
          }}
        />
      </span>
      <span style={estilos.valorGrafico}>{formatoReal.format(linha.valor)}</span>
    </button>
  )
}

function GraficoComparativoCategorias({ linhas, selecao, aoClicarBarra }) {
  if (!Array.isArray(linhas) || linhas.length === 0) return null
  const maxValor = Math.max(...linhas.map((l) => l.valor)) || 1
  const temSelecao = selecao !== TODAS_CATEGORIAS

  return (
    <section style={estilos.secao}>
      <h3 style={estilos.tituloSecao}>Comparativo de categorias</h3>
      <ul style={estilos.listaGrafico}>
        {linhas.map((linha) => {
          const ativa = temSelecao && selecao === linha.categoria
          const largura = Math.max(2, Math.round((linha.valor / maxValor) * 100))
          return (
            <li key={linha.categoria} style={estilos.itemGrafico}>
              <LinhaComparativa
                linha={linha}
                largura={largura}
                ativa={ativa}
                esmaecida={temSelecao}
                aoClicarBarra={aoClicarBarra}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default function AnalisePorCategoria({ periodo, selecao, aoTrocarSelecao }) {
  const { movimentacoes, compras, carregando, erro } = useAnaliseCategoria(periodo)
  const [mostrarRanking, setMostrarRanking] = useState(false)

  const dados = useMemo(() => {
    if (!periodo?.inicio || !periodo?.fim) return null
    return montarDadosAbaCategoria({ selecao, movimentacoes, compras, periodo })
  }, [selecao, periodo, movimentacoes, compras])

  function aoClicarLinha(linha) {
    aoTrocarSelecao(linha.categoria)
    setMostrarRanking(false)
  }

  function trocarSelecao(valor) {
    aoTrocarSelecao(valor)
    setMostrarRanking(false)
  }

  // Clique numa barra do gráfico = mesma ação do dropdown. Comportamento de
  // ALTERNÂNCIA só aqui (decisão 12/09/2026): clicar na categoria já
  // selecionada volta para "todas as categorias".
  function aoClicarBarra(linha) {
    const ativa = selecao !== TODAS_CATEGORIAS && selecao === linha.categoria
    aoTrocarSelecao(ativa ? TODAS_CATEGORIAS : linha.categoria)
    setMostrarRanking(false)
  }

  if (!periodo?.inicio || !periodo?.fim) {
    return <p style={estilos.aviso}>Defina um período válido para analisar por categoria.</p>
  }

  const visao = dados?.visao ?? 'resumo'
  const detalhe = dados?.detalhe ?? null
  const resumo = dados?.resumo ?? null

  return (
    <div>
      <div style={estilos.filtro}>
        <label style={estilos.rotulo} htmlFor="categoria-busca">
          Categoria
        </label>
        <SeletorCategoria
          id="categoria-busca"
          value={selecao}
          onChange={(e) => trocarSelecao(e.target.value)}
          valorTodas={TODAS_CATEGORIAS}
        />
      </div>

      {carregando && <p style={estilos.aviso}>Carregando lançamentos do período…</p>}
      {erro && <p style={estilos.erro}>{erro}</p>}

      {!carregando && !erro && dados && (
        <GraficoComparativoCategorias
          linhas={dados.resumo.linhas}
          selecao={selecao}
          aoClicarBarra={aoClicarBarra}
        />
      )}

      {!carregando && !erro && dados && visao === 'resumo' && (
        <section style={estilos.secao}>
          <h3 style={estilos.tituloSecao}>Gasto por categoria no período</h3>
          <p style={estilos.hint}>
            Selecione uma categoria no seletor ou clique numa linha para ver os
            lançamentos do grupo.
          </p>
          {resumo.linhas.length === 0 ? (
            <p style={estilos.vazio}>Nenhum gasto no período.</p>
          ) : (
            <ul style={estilos.listaResumo}>
              {resumo.linhas.map((linha) => (
                <li key={linha.categoria}>
                  <button
                    type="button"
                    onClick={() => aoClicarLinha(linha)}
                    style={estilos.itemResumo(false)}
                    title={`Ver os lançamentos de ${linha.categoria}`}
                  >
                    <span style={estilos.nomeCategoria}>{linha.categoria}</span>
                    <span style={estilos.valor}>{formatoReal.format(linha.valor)}</span>
                  </button>
                </li>
              ))}
              <li style={estilos.totalResumo}>
                <span style={estilos.nomeCategoria}>Total de gastos</span>
                <span style={estilos.valorForte}>{formatoReal.format(resumo.total)}</span>
              </li>
            </ul>
          )}
        </section>
      )}

      {!carregando && !erro && dados && visao === 'detalhe' && detalhe && (
        <>
          {/* Resultado filtrado em PRIMEIRO lugar (logo após o seletor). */}
          <section style={estilos.secao}>
            <div style={estilos.cabecalhoDetalhe}>
              <h3 style={estilos.tituloSecao}>
                {ROTULO_DETALHE[detalhe.categoria] ?? `Lançamentos de ${detalhe.categoria}`}
              </h3>
              <strong style={estilos.totalDetalhe}>{formatoReal.format(detalhe.total)}</strong>
            </div>

            {detalhe.lancamentos.length === 0 ? (
              <p style={estilos.vazio}>
                {detalhe.categoria === ''
                  ? 'Nenhum lançamento sem categoria no período.'
                  : `Nenhum lançamento de ${detalhe.categoria} no período.`}
              </p>
            ) : (
              <ul style={estilosComuns.lista}>
                {detalhe.lancamentos.map((l) => (
                  <li key={`${l.fonte}-${l.data}-${l.descricao}-${l.valor}`} style={estilosComuns.item}>
                    <div style={estilos.colunaDescricao}>
                      <span style={estilos.dataLancamento}>{formatarData(l.data)}</span>
                      <span style={estilos.descricaoLancamento}>{l.descricao || 'Sem descrição'}</span>
                    </div>
                    <div style={estilos.colunaValor}>
                      <span style={l.fonte === 'compra' ? estilos.origemCompra : estilos.origemMov}>
                        {l.fonte === 'compra' ? 'Compra no cartão' : 'Movimentação'}
                      </span>
                      <span style={estilos.valorLancamento}>{formatoReal.format(l.valor)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Ranking geral recolhido atrás do "Ver todas as categorias" — a
              seleção atual destaca a linha ativa e o clique troca de
              categoria (reescondendo o ranking). */}
          <button
            type="button"
            onClick={() => setMostrarRanking((v) => !v)}
            style={estilos.alternarRanking}
            aria-expanded={mostrarRanking}
          >
            {mostrarRanking ? 'Ocultar ranking de categorias' : 'Ver todas as categorias'}
          </button>
          {mostrarRanking && (
            <section style={estilos.secaoSecundaria}>
              <h3 style={estilos.tituloSecundario}>Gasto por categoria no período</h3>
              {resumo.linhas.length === 0 ? (
                <p style={estilos.vazio}>Nenhum gasto no período.</p>
              ) : (
                <ul style={estilos.listaResumo}>
                  {resumo.linhas.map((linha) => (
                    <li key={linha.categoria}>
                      <button
                        type="button"
                        onClick={() => aoClicarLinha(linha)}
                        style={estilos.itemResumo(selecao === linha.categoria)}
                        title={`Ver os lançamentos de ${linha.categoria}`}
                      >
                        <span style={estilos.nomeCategoria}>{linha.categoria}</span>
                        <span style={estilos.valor}>{formatoReal.format(linha.valor)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}

const estilos = {
  filtro: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    alignItems: 'center',
    gap: '0.6rem',
    marginBottom: '1.25rem',
    maxWidth: '420px',
  },
  rotulo: {
    color: COR_TEXTO_SUAVE,
    fontSize: '0.85rem',
    fontWeight: 600,
  },
  secao: {
    marginBottom: '1.5rem',
    background: 'rgba(17, 24, 39, 0.55)',
    border: '1px solid #1f2937',
    borderRadius: '14px',
    padding: '1rem 1.1rem',
  },
  secaoSecundaria: {
    marginBottom: '0.5rem',
    background: 'rgba(17, 24, 39, 0.3)',
    border: '1px solid #1f2937',
    borderRadius: '14px',
    padding: '0.85rem 1.1rem',
    opacity: 0.9,
  },
  alternarRanking: {
    display: 'block',
    width: '100%',
    margin: '0 0 1.25rem',
    padding: '0.6rem 0.8rem',
    borderRadius: '10px',
    border: '1px dashed #374151',
    background: 'transparent',
    color: COR_PRINCIPAL,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    fontWeight: 600,
    textAlign: 'center',
    transition: 'border-color 150ms ease, background 150ms ease',
  },
  tituloSecao: {
    margin: '0 0 0.3rem',
    fontSize: '1rem',
    fontWeight: 'bold',
    color: COR_TEXTO_FORTE,
  },
  tituloSecundario: {
    margin: '0 0 0.6rem',
    fontSize: '0.85rem',
    fontWeight: 600,
    color: COR_TEXTO_SUAVE,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  hint: {
    margin: '0 0 0.9rem',
    color: COR_TEXTO_SUAVE,
    fontSize: '0.8rem',
  },
  listaResumo: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.45rem',
  },
  itemResumo: (ativa) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '0.65rem 0.8rem',
    borderRadius: '10px',
    border: ativa ? '1px solid #42A5F5' : '1px solid #1f2937',
    background: ativa ? '#17213a' : '#111827',
    color: COR_TEXTO_FORTE,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.9rem',
    textAlign: 'left',
    transition: 'border-color 150ms ease, background 150ms ease',
  }),
  nomeCategoria: { fontWeight: 600 },
  valor: { color: COR_TEXTO_SUAVE, fontVariantNumeric: 'tabular-nums' },
  totalResumo: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.65rem 0.8rem',
    borderTop: '1px dashed #374151',
  },
  valorForte: { color: COR_PRINCIPAL, fontWeight: 'bold', fontVariantNumeric: 'tabular-nums' },
  listaGrafico: {
    listStyle: 'none',
    margin: '0.25rem 0 0',
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.55rem',
  },
  itemGrafico: {
    borderRadius: '8px',
  },
  linhaGrafico: {
    // Botão resetado: herda tipografia, sem borda/fundo nativos.
    display: 'grid',
    gridTemplateColumns: 'minmax(7rem, 28%) 1fr auto',
    alignItems: 'center',
    gap: '0.7rem',
    width: '100%',
    padding: 0,
    margin: 0,
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'opacity 120ms ease',
  },
  linhaGraficoAtiva: {
    // A linha da categoria selecionada fica com o mesmo "clique" visual do
    // itemResumo ativo (borda azul), reforçando qual é a categoria detalhada.
    borderLeft: `3px solid ${COR_PRINCIPAL}`,
    paddingLeft: '0.3rem',
    marginLeft: '-0.6rem',
  },
  linhaGraficoHover: {
    opacity: 0.85,
  },
  barraHover: {
    // Feedback sutil no hover (linha inteira levemente mais clara).
    filter: 'brightness(1.08)',
  },
  nomeGrafico: {
    color: COR_TEXTO_SUAVE,
    fontSize: '0.82rem',
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'right',
  },
  trilha: {
    display: 'block',
    height: '10px',
    borderRadius: '999px',
    background: '#1f2937',
    overflow: 'hidden',
  },
  barra: {
    display: 'block',
    height: '100%',
    borderRadius: '999px',
    transition: 'width 200ms ease, background 150ms ease',
  },
  valorGrafico: {
    color: COR_TEXTO_FORTE,
    fontSize: '0.82rem',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    minWidth: '5.5rem',
    textAlign: 'right',
  },
  cabecalhoDetalhe: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '0.75rem',
    marginBottom: '0.9rem',
  },
  totalDetalhe: {
    color: COR_PRINCIPAL,
    fontSize: '1.05rem',
    fontVariantNumeric: 'tabular-nums',
  },
  vazio: { margin: 0, color: COR_TEXTO_SUAVE, fontSize: '0.85rem' },
  aviso: { margin: '0.75rem 0', color: COR_TEXTO_SUAVE, fontSize: '0.85rem' },
  erro: estilosComuns.erro,
  colunaDescricao: { display: 'flex', flexDirection: 'column', gap: '0.15rem' },
  dataLancamento: { color: COR_TEXTO_SUAVE, fontSize: '0.78rem' },
  descricaoLancamento: { color: COR_TEXTO_FORTE, fontWeight: 500, fontSize: '0.9rem' },
  colunaValor: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' },
  origemMov: { color: COR_MOVIMENTACAO, fontSize: '0.72rem' },
  origemCompra: { color: COR_COMPRA, fontSize: '0.72rem' },
  valorLancamento: { color: '#f87171', fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
}