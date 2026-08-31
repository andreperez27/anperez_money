// ============================================================================
// MÉDIA MÓVEL (ETAPA 06/P5) — pré-preenchimento de variáveis do Condomínio
// ============================================================================
// Lib PURA: sem React, sem Supabase, sem DOM, sem relógio. Apenas a conta
// aritmética da média móvel usada para SUGERIR os valores de Gás/Água na tela
// do Condomínio, com base nos últimos N valores realizados.
//
// REGRAS DE OURO:
//   • A média NUNCA trava o campo: a sugestão é apenas um pré-preenchimento
//     editável (a decisão final é sempre do usuário, que pode sobrescrever).
//   • Aplica-se SOMENTE ao Condomínio (variáveis Gás/Água). Nenhuma outra
//     despesa usa média móvel.
//   • Dinheiro em REAIS (mesma convenção do front: calcularTotalCondominio
//     trabalha em reais, os campos de texto do formulário também). Quem ler
//     do banco (movimentacoes/planejamentos em CENTAVOS) converte ANTES de
//     chamar esta lib (ver sugestaoMediaMovel no GeradorCondominio).
//   • [] sempre devolve 0 (sem erro, sem falha): ainda não há histórico.
//   • mantenha a função determinística e com arredondamento de centavos —
//     evita 1463.1699... como no cálculo do total do condomínio.
// ============================================================================

// Média aritmética dos ÚLTIMOS `janela` valores NUMÉRICOS de `historico`,
// em ordem cronológica. Retorna 0 quando não há valores.
//
//   calcularMediaMovel({ historico: [10, 20, 30] })           // → 20
//   calcularMediaMovel({ historico: [10, 20, 30], janela: 2 }) // → 25  (20+30)/2
//   calcularMediaMovel({ historico: [5] })                     // → 5
//   calcularMediaMovel({ historico: [] })                      // → 0
//   calcularMediaMovel({ historico: [40, 50], janela: 5 })     // → 45 (todos)
export function calcularMediaMovel({ historico = [], janela = 3 } = {}) {
  if (!Array.isArray(historico)) {
    throw new Error('calcularMediaMovel espera historico como lista.')
  }
  const n = Number(janela)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('calcularMediaMovel espera janeja inteira > 0.')
  }

  // Últimos `janela` valores numéricos (não-NaN) em ordem cronológica.
  const valores = historico
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .slice(-n)

  if (valores.length === 0) return 0

  const soma = valores.reduce((acc, v) => acc + v, 0)
  // Arredonda para centavos (mesma regra de "round(total, 2)" do front).
  return Math.round((soma / valores.length + Number.EPSILON) * 100) / 100
}
