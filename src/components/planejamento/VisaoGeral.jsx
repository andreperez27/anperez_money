import { useMemo } from 'react'
import { estilosComuns, formatoReal } from '../../lib/compartilhados'
import { agruparPorMes } from '../../lib/planejamentoAgregado'
import { calcularResumoPlanejamentos } from '../../lib/planejamentoCalc'
import CardRendaComprometida from './CardRendaComprometida'
import { MES_ABREV } from './comum'

// ============================================================================
// VISÃO GERAL DO PLANEJAMENTO — parte superior da tela UNIFICADA
// ============================================================================
// Responde imediatamente: quanto tenho previsto de entrada/saída, qual o
// resultado previsto e o que está planejado no período. Os TOTAIS/CONTAGENS
// chegam PRONTOS via props (cálculo exclusivo de planejamentoCalc.js) — a
// única agregação feita aqui é a divisão "Por mês" dos períodos maiores, que
// reutiliza agruparPorMes + a MESMA função pura de resumo do domínio.
// A lista COMPLETA do período (com ações por linha) fica por conta do
// Lancamentos.jsx, renderizado logo abaixo pela página (unificação 13/09/2026).
// ============================================================================

// Resumo "vazio" para mês que existe na timeline mas não tem nada a somar
// (ex.: mês com só previsto de destino cartão absorvido pela fatura — o
// dinheiro sai no vencimento, que pode estar noutro mês). Sem isso a avaliação
// de `r.totais` quebraria quando o mês não gerar grupo no somatório.
const RESUMO_ZERO = {
  totais: { entradas: 0, saidas: 0, resultado: 0 },
  contagens: { previsto: 0, realizado: 0, cancelado: 0 },
}

export default function VisaoGeral({
  carregando,
  erro,
  totais,
  contagens,
  itens,
  itensParaSomatorio,
  dividirPorMes,
  saldoProjetado,
  saldoProjetadoCarregando,
  saldoProjetadoErro,
  rotuloPeriodo,
  inicioISO,
  fimISO,
  saldoRealHoje,
}) {

  // Divisão por mês civil (só para Mês/Trimestre/Semestre). Lib pura, ordem
  // cronológica garantida. A lista de meses (e as linhas dentro de cada mês)
  // vem dos itens VISÍVEIS — a compra prevista de cartão e a fatura projetada
  // continuam aparecendo normalmente na timeline.
  const gruposMes = useMemo(
    () => (dividirPorMes ? agruparPorMes(itens) : []),
    [dividirPorMes, itens],
  )

  // Resumo por mês usa SEMPRE o array PARA SOMATÓRIO (mesma regra do card
  // principal): o previsto de destino cartão absorvido pela fatura já está
  // dentro da fatura e NÃO soma como linha própria no mês. Com isso, um mês
  // que contém apenas previsto de cartão (cujo vencimento cai noutro mês)
  // termina sem grupo próprio → entra via RESUMO_ZERO (tudo 0,00). Sem esse
  // desacoplamento, o mês somava o previsto do cartão E, quando a fatura caía
  // no mesmo período, o mesmo real entrava duas vezes (bug de 31/08, parcial).
  const resumoPorMes = useMemo(() => {
    if (!dividirPorMes) return new Map()
    const mapa = new Map()
    for (const g of agruparPorMes(itensParaSomatorio || [])) {
      mapa.set(g.chave, calcularResumoPlanejamentos(g.itens))
    }
    return mapa
  }, [dividirPorMes, itensParaSomatorio])

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
            {/* Card único combinado: SALDO PROJETADO (destaque) + resultado
                previsto da janela (detalhe discreto), padrão do card "Carga
                horária" do Ponto: número grande em cima, meta pequena embaixo. */}
            <div style={estilos.cardResumo}>
              <span style={estilos.rotuloCard}>Saldo projetado</span>
              {saldoProjetadoCarregando ? (
                <span style={{ ...estilos.valorCard, color: '#9ca3af' }}>…</span>
              ) : saldoProjetadoErro ? (
                <span style={{ ...estilos.valorCard, color: '#f87171', fontSize: '0.85rem' }}>indisponível</span>
              ) : saldoProjetado === null || saldoProjetado === undefined ? (
                <span style={{ ...estilos.valorCard, color: '#9ca3af' }}>—</span>
              ) : (
                <span
                  style={{
                    ...estilos.valorCard,
                    color: Number(saldoProjetado) >= 0 ? '#4ade80' : '#f87171',
                  }}
                >
                  {formatoReal.format(Number(saldoProjetado) || 0)}
                </span>
              )}
              <span
                style={{
                  ...estilos.metaCard,
                  color: totais.resultado >= 0 ? '#4ade80' : '#f87171',
                }}
              >
                resultado do {rotuloPeriodo}: {formatoReal.format(totais.resultado)}
              </span>
            </div>
            {/* Percentual de renda comprometida — mesmo array para somatório,
                cenário fechado/atual/futuro decidido na lib pura (datas x hoje);
                no período atual o saldo REAL de hoje é a base disponível. */}
            <CardRendaComprometida
              itens={itensParaSomatorio}
              inicioISO={inicioISO}
              fimISO={fimISO}
              saldoRealHoje={saldoRealHoje}
            />
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
                  const r = resumoPorMes.get(g.chave) || RESUMO_ZERO
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

          {/* Lista completa do período: renderizada pelo Lancamentos.jsx logo
              abaixo pela página (unificação Visão geral + Lançamentos) */}
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
  metaCard: { color: '#9ca3af', fontSize: '0.78rem' },
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
}
