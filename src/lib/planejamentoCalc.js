// Regras financeiras de agregação dos Planejamentos (ETAPA 06/E3).
// Função PURA: sem React, sem Supabase, sem semana — fácil de testar
// (padrão extratoCalc: lógica de números vive em lib, não em hooks).
//
// Semântica aprovada:
// - CANCELADO NÃO participa dos totais financeiros (preserva histórico,
//   mas deixa de ser previsão);
// - Contagens contam TODOS os registros por estado, independente dos
//   totais;
// - Resultado é FLUXO previsto (entradas - saídas) e nunca "saldo".
export function calcularResumoPlanejamentos(itens = []) {
  const totais = { entradas: 0, saidas: 0, resultado: 0 }
  const contagens = { previsto: 0, realizado: 0, cancelado: 0 }

  for (const item of itens) {
    // Contagem: todos os estados entram aqui.
    if (item.estado === 'previsto') contagens.previsto += 1
    else if (item.estado === 'realizado') contagens.realizado += 1
    else if (item.estado === 'cancelado') contagens.cancelado += 1

    // Totais: cancelado fica de fora das somas.
    if (item.estado === 'cancelado') continue

    const valor = Number(item.valor || 0)
    if (item.tipo_op === 'Entrada') totais.entradas += valor
    else if (item.tipo_op === 'Saida') totais.saidas += valor
  }

  totais.resultado = totais.entradas - totais.saidas
  return { totais, contagens }
}
