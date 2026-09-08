// ============================================================================
// GASTO NO MÊS DOS CARTÕES — lib PURA (sem Supabase, testável).
// ============================================================================
// "Gasto no Mês" = soma do VALOR TOTAL das compras realizadas no mês de
// referência, independente de parcela e de fatura:
//   • uma compra de R$ 300 em 3x feita em setembro entra em setembro como
//     R$ 300 INTEIRO — as parcelas de outubro/novembro NÃO geram valor algum
//     nesses meses (o gasto já foi todo contabilizado no mês da compra);
//   • não olha mes_fatura (fatura soma parcela a parcela, é outro conceito);
//   • não olha status de pagamento da fatura.
// Critério definido em 08/09/2026 (card "Gasto no Mês" de Cartões): filtra só
// por compras.data dentro do mês-alvo (ano+mês). Contrato de entrada: lista de
// compras { data: 'YYYY-MM-DD', valor_total: number|string, ... }.
// ============================================================================

// Mês-alvo 'YYYY-MM' → 'YYYY-MM-DD' do último dia (para o filtro data <= fim).
export function ultimoDiaDoMes(mes) {
  const [anoStr, mesStr] = String(mes || '').split('-')
  const ano = Number(anoStr)
  const m = Number(mesStr)
  if (!Number.isInteger(ano) || !Number.isInteger(m) || m < 1 || m > 12) return null
  const ultimoDia = new Date(Date.UTC(ano, m, 0)).getUTCDate()
  return `${ano}-${String(m).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`
}

// Compras cuja data cai no mês dado ('YYYY-MM'). O corte usa o prefixo da
// data ISO — data vem do banco como 'YYYY-MM-DD'.
export function comprasDoMes(compras = [], mes) {
  if (!mes) return []
  return (compras || []).filter((c) => c && typeof c.data === 'string' && c.data.slice(0, 7) === mes)
}

// Soma do valor_total das compras do mês. Defensiva: ignora valor não
// numérico. Retorna number em ponto flutuante (mesma precisão de Number()).
export function somarGastoDoMes(compras = [], mes) {
  let soma = 0
  for (const c of comprasDoMes(compras, mes)) {
    const valor = Number(c.valor_total)
    if (Number.isFinite(valor)) soma += valor
  }
  return soma
}