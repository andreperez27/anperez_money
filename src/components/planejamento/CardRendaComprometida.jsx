// ============================================================================
// CARD "RENDA COMPROMETIDA" (Visão Geral do Planejamento)
// ============================================================================
// Percentual da renda comprometida no período, ao lado do saldo projetado.
// Só render + uma chamada à função PURA calcularRendaComprometida (mesma lib
// do resumo) sobre o MESMO array já carregado pela página (itensParaSomatorio)
// — nenhum hook novo, nenhuma query adicional, nenhuma regra reimplementada.
// No período ATUAL a base é o saldo do dia anterior ao início + as entradas do
// período (vem do MESMO hook do saldo projetado — aqui só chega o número, sem
// refazer a busca); no FUTURO a base é a entrada prevista do período inteiro.
//
// Visual (padrão já usado em AnalisePorCategoria — Relatórios): barra
// horizontal em CSS puro, uma faixa só (o comprometido em destaque sobre a
// trilha esmaecida que é o fundo). Sem toggle/seleção. O texto abaixo da barra
// muda conforme o modo calculado na lib:
//   • fechado: "X% da renda comprometido no período"
//   • aberto : "X% da renda já comprometido até agora (apenas fixo e parcelado)"
// Sem base de renda (percentual null) ou sem período: estado vazio explícito,
// sem divisão por zero e sem quebrar a tela.
// ============================================================================

import { useMemo } from 'react'
import { formatoReal, hoje } from '../../lib/compartilhados'
import { calcularRendaComprometida } from '../../lib/planejamentoCalc'

const COR_PRINCIPAL = '#42A5F5'

export default function CardRendaComprometida({ itens = [], inicioISO, fimISO, saldoInicioPeriodo = null }) {
  const res = useMemo(
    () => calcularRendaComprometida({ itens, inicioISO, fimISO, hojeISO: hoje(), saldoInicioPeriodo }),
    // inicioISO/fimISO únicos por período; itens muda a cada carga; o saldo do
    // dia anterior ao início vem do hook do saldo projetado. hoje() é estável
    // no mesmo dia civil — não entra nas dependências.
    [itens, inicioISO, fimISO, saldoInicioPeriodo], // eslint-disable-line react-hooks/exhaustive-deps
  )

  if (!inicioISO || !fimISO || !res || res.percentual === null) {
    return (
      <div style={estilos.cardResumo}>
        <span style={estilos.rotuloCard}>Renda comprometida</span>
        <span style={estilos.vazio}>sem dados suficientes neste período</span>
      </div>
    )
  }

  const largura = Math.max(2, Math.min(100, Math.round(res.percentual)))
  const texto =
    res.modo === 'fechado'
      ? `${res.percentual}% da renda comprometido no período`
      : `${res.percentual}% da renda já comprometido até agora (apenas fixo e parcelado)`

  return (
    <div style={estilos.cardResumo}>
      <span style={estilos.rotuloCard}>Renda comprometida</span>
      <strong style={estilos.valorDestaque}>{res.percentual}%</strong>
      <span style={estilos.trilha}>
        <span style={{ ...estilos.barra, width: `${largura}%` }} />
      </span>
      <span style={estilos.metaCard}>{texto}</span>
      <span style={estilos.baseCard}>base: {formatoReal.format(res.rendaBase)} · comprometido: {formatoReal.format(res.comprometidoBase)}</span>
    </div>
  )
}

const estilos = {
  // Mesmo visual dos demais cards do resumo (VisaoGeral): fundo #111827,
  // borda #1f2937, flex de card companheiro do "Saldo projetado".
  cardResumo: {
    flex: '1 1 160px',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
    padding: '0.85rem 1rem',
    borderRadius: '12px',
    background: '#111827',
    border: '1px solid #1f2937',
  },
  rotuloCard: { color: '#9ca3af', fontSize: '0.8rem' },
  valorDestaque: { fontSize: '1.3rem', fontWeight: 'bold', color: COR_PRINCIPAL },
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
    background: COR_PRINCIPAL,
    transition: 'width 200ms ease, background 150ms ease',
  },
  metaCard: { color: '#9ca3af', fontSize: '0.78rem' },
  baseCard: { color: '#6b7280', fontSize: '0.72rem' },
  vazio: { color: '#9ca3af', fontSize: '0.8rem' },
}