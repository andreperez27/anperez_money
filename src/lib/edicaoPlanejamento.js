// ============================================================================
// EDIÇÃO DE PLANEJAMENTO — função PURA que monta as alterações PARCIAIS
// ============================================================================
// Problema 2 (andaime 01/09/2026, com André): a edição de um lançamento passou
// de "trocar só o destino" para um formulário completo (descrição, valor, data,
// tipo, destino). O hook editarPlanejamento é PARCIAL — cada campo enviado é
// validado e gravado; campos não tocados nunca são sobrescritos. Esta função
// concentra a lógica de "o que mudou?", comparando o item original com os
// valores do formulário e devolvendo APENAS o que diverge.
//
// Regras (mesma semântica do antigo "Editar destino" para o direcionamento):
//   • "Conta" limpa o direcionamento (destino_padrao = null) e grava a CONTA de
//     destino escolhida em conta_destino_id ('' → null, corrige a escolha que
//     antes era ignorada);
//   • "Cartão" grava destino_padrao = 'cartao' + cartao_padrao_id e zera uma
//     conta_destino_id pendente;
//   • valor em reais (o formulário envia texto com vírgula; aqui já recebe o
//     número); data muda → o hook recalcula ano_semana/semana.
// Devolve {} quando nada mudou (o formulário mostra "Nenhuma alteração").
// ============================================================================

const TIPOS_OP = ['Entrada', 'Saida']

export function montarAlteracoesEdicao({
  item,
  descricao,
  valor,
  dataPrevista,
  tipoOp,
  destino,
  contaId,
  cartaoId,
}) {
  const alteracoes = {}

  const desc = String(descricao ?? '').trim()
  if (desc && desc !== (item.descricao ?? '')) alteracoes.descricao = desc

  const valorNum = Number(valor)
  if (Number.isFinite(valorNum) && valorNum > 0 && valorNum !== Number(item.valor)) {
    alteracoes.valor = valorNum
  }

  if (dataPrevista && dataPrevista !== item.data_prevista) {
    alteracoes.data_prevista = dataPrevista
  }

  if (tipoOp !== (item.tipo_op ?? 'Saida')) {
    if (TIPOS_OP.includes(tipoOp)) alteracoes.tipo_op = tipoOp
  }

  // Destino padrão — semântica herdada do "Editar destino", mais a escolha
  // explícita de CONTA (correção 01/09/2026): o select "Conta de destino" do
  // EditarPlanejamentoForm passou a gravar conta_destino_id ('' → null).
  if (destino === 'cartao') {
    if (item.destino_padrao !== 'cartao') {
      alteracoes.destino_padrao = 'cartao'
      alteracoes.cartao_padrao_id = cartaoId || null
      // Ao trocar para cartão, zera qualquer conta de destino pendente
      if (item.conta_destino_id) {
        alteracoes.conta_destino_id = null
      }
    } else if (cartaoId !== (item.cartao_padrao_id ?? null)) {
      alteracoes.cartao_padrao_id = cartaoId || null
    }
  } else {
    // Modo Conta: limpar direcionamento de cartão (se houver) + gravar a conta
    // de destino escolhida (ou null quando "Sem conta específica").
    if (item.destino_padrao === 'cartao') {
      alteracoes.destino_padrao = null
      alteracoes.cartao_padrao_id = null
    }
    const contaAtual = item.conta_destino_id ?? null
    const novaConta = contaId === '' || contaId === null ? null : contaId
    if (novaConta !== contaAtual) {
      alteracoes.conta_destino_id = novaConta
    }
  }

  return alteracoes
}