import { useMemo } from 'react'
import { estilosComuns, formatoReal, formatarData, hoje } from '../../lib/compartilhados'
import { agruparPorMes } from '../../lib/planejamentoAgregado'
import { calcularResumoPlanejamentos } from '../../lib/planejamentoCalc'
import {
  RÓTULO_ESTADO,
  RÓTULO_TIPO,
  ehEntrada,
  ehDisponivel,
  badgeEstado,
  conteudoItem,
  MES_ABREV,
  estilosItem,
} from './comum'

// ============================================================================
// VISÃO GERAL DO PLANEJAMENTO (ETAPA 06/E5-F4 — primeira versão)
// ============================================================================
// Responde imediatamente: quanto tenho previsto de entrada/saída, qual o
// resultado previsto e o que está planejado no período. Os TOTAIS/CONTAGENS
// chegam PRONTOS via props (cálculo exclusivo de planejamentoCalc.js) — a
// única agregação feita aqui é a divisão "Por mês" dos períodos maiores, que
// reutiliza agruparPorMes + a MESMA função pura de resumo do domínio.
// A visão analítica enriquecida fica para a próxima etapa (F5).
// ============================================================================

const QUANTOS_PROXIMOS = 5

export default function VisaoGeral({
  carregando,
  erro,
  totais,
  contagens,
  itens,
  dividirPorMes,
  aoVerLancamentos,
}) {
  const dataHoje = hoje()

  // Divisão por mês civil (só para Mês/Trimestre/Semestre). Lib pura, ordem
  // cronológica garantida; o resumo de cada grupo usa a função única do domínio.
  const gruposMes = useMemo(
    () => (dividirPorMes ? agruparPorMes(itens) : []),
    [dividirPorMes, itens],
  )

  // Próximos lançamentos: primeiros N não cancelados (a lista já chega
  // ordenada por data_prevista das duas consultas do domínio).
  const proximos = itens.filter((item) => item.estado !== 'cancelado').slice(0, QUANTOS_PROXIMOS)

  return (
    <section>
      {carregando && <p style={estilosComuns.mensagem}>Carregando visão geral...</p>}

      {!carregando && erro && (
        <div>
          <p style={estilosComuns.erro}>{erro}</p>
          <p style={estilosComuns.mensagem}>Tente navegar para outro período e voltar.</p>
        </div>
      )}

      {!carregando && !erro && (
        <>
          {/* Resumo financeiro — valores prontos do domínio, sem recálculo */}
          <div style={estilos.resumo}>
            <div style={estilos.cardResumo}>
              <span style={estilos.rotuloCard}>Entradas previstas</span>
              <span style={{ ...estilos.valorCard, color: '#4ade80' }}>
                {formatoReal.format(totais.entradas)}
              </span>
            </div>
            <div style={estilos.cardResumo}>
              <span style={estilos.rotuloCard}>Saídas previstas</span>
              <span style={{ ...estilos.valorCard, color: '#f87171' }}>
                {formatoReal.format(totais.saidas)}
              </span>
            </div>
            <div style={estilos.cardResumo}>
              <span style={estilos.rotuloCard}>Resultado previsto</span>
              <span
                style={{
                  ...estilos.valorCard,
                  color: totais.resultado >= 0 ? '#4ade80' : '#f87171',
                }}
              >
                {formatoReal.format(totais.resultado)}
              </span>
            </div>
          </div>
          <p style={{ ...estilosComuns.mensagem, margin: '-0.25rem 0 1.25rem', fontSize: '0.85rem' }}>
            {contagens.previsto} previsto(s) · {contagens.realizado} realizado(s) ·{' '}
            {contagens.cancelado} cancelado(s)
          </p>

          {/* Por mês — apresentação simples (sem gráficos nesta etapa) */}
          {gruposMes.length > 0 && (
            <div style={estilos.divisao}>
              <h3 style={estilos.tituloSecao}>Por mês</h3>
              <ul style={estilos.listaMeses}>
                {gruposMes.map((g) => {
                  const r = calcularResumoPlanejamentos(g.itens)
                  return (
                    <li key={g.chave} style={estilos.linhaMes}>
                      <span style={estilos.mesChave}>
                        {MES_ABREV[Number(g.chave.slice(5, 7)) - 1]} / {g.chave.slice(0, 4)}
                      </span>
                      <span style={{ ...estilos.mesValor, color: '#4ade80' }}>
                        +{formatoReal.format(r.totais.entradas)}
                      </span>
                      <span style={{ ...estilos.mesValor, color: '#f87171' }}>
                        −{formatoReal.format(r.totais.saidas)}
                      </span>
                      <span
                        style={{
                          ...estilos.mesValor,
                          color: r.totais.resultado >= 0 ? '#4ade80' : '#f87171',
                        }}
                      >
                        = {formatoReal.format(r.totais.resultado)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* Próximos lançamentos do período */}
          {itens.length > 0 && (
            <div style={estilos.blocoProximos}>
              <h3 style={estilos.tituloSecao}>Próximos lançamentos</h3>
              <ul style={estilosItem.lista}>
                {proximos.map((item) => {
                  const disponivel = ehDisponivel(item, dataHoje)
                  const ehSerie = !!item.serie_id
                  return (
                    <li key={item.id} style={estilos.linhaProximo}>
                      <span style={estilosItem.data}>{formatarData(item.data_prevista)}</span>
                      <span style={{ ...conteudoItem(item), flex: '1 1 auto', minWidth: 0 }}>
                        {item.descricao}
                        {ehSerie && (
                          <span style={{ ...estilosItem.badgeParcela, marginLeft: '0.5rem' }}>
                            {item.parcela_numero}/{item.total_parcelas}
                          </span>
                        )}
                        {disponivel && (
                          <span style={{ ...estilosItem.badgeDisponivel, marginLeft: '0.5rem' }}>
                            Disponível
                          </span>
                        )}
                      </span>
                      <span style={badgeEstado(item.estado)}>
                        {RÓTULO_ESTADO[item.estado] ?? item.estado}
                      </span>
                      <span
                        style={{
                          ...estilosItem.valor,
                          color: ehEntrada(item.tipo_op) ? '#4ade80' : '#f87171',
                        }}
                      >
                        {RÓTULO_TIPO(item.tipo_op)} · {formatoReal.format(Number(item.valor))}
                      </span>
                    </li>
                  )
                })}
              </ul>
              <button type="button" onClick={aoVerLancamentos} style={estilos.botaoVerTodos}>
                Ver todos em Lançamentos →
              </button>
            </div>
          )}

          {itens.length === 0 && (
            <div style={estilos.vazio}>
              <p style={{ ...estilosComuns.mensagem, margin: 0 }}>
                Nenhum planejamento neste período.
              </p>
              <p style={{ ...estilosComuns.mensagem, margin: 0, fontSize: '0.85rem' }}>
                Use ‹ › para consultar outros períodos ou cadastre na aba Lançamentos.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  )
}

const estilos = {
  resumo: { display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' },
  cardResumo: { flex: '1 1 160px', display: 'flex', flexDirection: 'column', gap: '0.25rem', padding: '0.85rem 1rem', borderRadius: '12px', background: '#111827', border: '1px solid #1f2937' },
  rotuloCard: { color: '#9ca3af', fontSize: '0.8rem' },
  valorCard: { fontSize: '1.15rem', fontWeight: 'bold' },
  divisao: { marginBottom: '1.25rem' },
  tituloSecao: { margin: '0 0 0.6rem', color: '#e5e7eb', fontSize: '0.95rem' },
  listaMeses: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  linhaMes: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '0.75rem',
    padding: '0.55rem 0.9rem',
    borderRadius: '10px',
    background: '#111827',
    border: '1px solid #1f2937',
  },
  mesChave: { color: '#e5e7eb', fontWeight: 'bold', minWidth: '90px' },
  mesValor: { fontWeight: 'bold', whiteSpace: 'nowrap', fontSize: '0.9rem' },
  blocoProximos: { marginBottom: '1.25rem' },
  linhaProximo: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '0.6rem',
    padding: '0.65rem 0.9rem',
    borderRadius: '10px',
    background: '#111827',
    border: '1px solid #1f2937',
  },
  botaoVerTodos: {
    marginTop: '0.6rem',
    padding: '0.45rem 0.9rem',
    borderRadius: '999px',
    border: '1px solid #374151',
    background: 'transparent',
    color: '#42A5F5',
    cursor: 'pointer',
    fontSize: '0.85rem',
  },
  vazio: { padding: '1.25rem', borderRadius: '10px', background: '#111827', border: '1px dashed #374151', display: 'flex', flexDirection: 'column', gap: '0.35rem', textAlign: 'center' },
}
