import assert from 'node:assert/strict'
import { montarProjecao } from '../src/lib/faturaProjecao.js'
import { calcularResumoPlanejamentos } from '../src/lib/planejamentoCalc.js'

// ============================================================================
// Testes da PROJEÇÃO DA FATURA no Planejamento (lib pura faturaProjecao.js).
// Rodar: node scripts/teste_faturaProjecao.mjs
//
// Foco central: a DUPLA CONTAGEM. Um previsto de destino Cartão já soma como
// linha própria; quando é absorvido por uma fatura projetada do seu (cartão,
// mês), o valor NÃO pode contar duas vezes no total do período. O teste
// confirma que `itensParaSomatorio` (o que alimenta calcularResumoPlanejamentos)
// não duplica, enquanto `itensVisiveis` mantém o previsto na linha do tempo.
// ============================================================================

let ok = 0
let falhou = 0

function verificar(nome, fn) {
  try {
    fn()
    ok++
    console.log(`ok      — ${nome}`)
  } catch (e) {
    falhou++
    console.error(`FALHOU  — ${nome}\n         ${e.message}`)
  }
}

// Cartão A: fechamento dia 15, vencimento dia 10.
const cartaoA = { id: 'cartao-A', nome: 'Azul', dia_fechamento: 15, dia_vencimento: 10 }

function previstoCartao(id, dataPrevista, valor) {
  return {
    id,
    estado: 'previsto',
    destino_padrao: 'cartao',
    cartao_padrao_id: 'cartao-A',
    data_prevista: dataPrevista,
    valor,
    tipo_op: 'Saida',
  }
}
function itemNormal(id, dataPrevista, valor) {
  return {
    id,
    estado: 'previsto',
    data_prevista: dataPrevista,
    valor,
    tipo_op: 'Saida',
  }
}

// --- dupla contagem ----------------------------------------------------------
verificar('P1 — previsto de cartão absorvido NÃO duplica no somatório do período', () => {
  // Previsto cai em maio (compra 20/abr após fechamento 15 → mes de maio),
  // vencimento da fatura 10/mai (dentro da faixa de maio).
  const itensBase = [previstoCartao('p1', '2026-04-20', 300)]
  const { itensVisiveis, itensParaSomatorio } = montarProjecao({
    itensBase,
    cartoes: [cartaoA],
    faturasReais: [],
    inicioISO: '2026-05-01',
    fimISO: '2026-05-31',
  })

  // Timeline mantém o previsto como linha + a fatura projetada.
  assert.equal(itensVisiveis.length, 2)
  assert.ok(itensVisiveis.some((i) => i.id === 'p1')) // previsto continua visível
  assert.ok(itensVisiveis.some((i) => i.fatura === true)) // fatura aparece

  // Somatório: só a fatura carrega o 300 (previsto absorvido sai).
  const resumo = calcularResumoPlanejamentos(itensParaSomatorio)
  assert.equal(resumo.totais.saidas, 300) // 300 uma vez, não 600
})

verificar('P2 — previsto de cartão com mês FORA da faixa NÃO conta como saída do período', () => {
  // Faixa de abril: o previsto (data 20/abr) gera fatura de MAIO (vencimento
  // 10/mai, fora da faixa de abril). Nenhum dinheiro sai da conta em abril,
  // logo o valor NÃO pode entrar nos totais de abril.
  const itensBase = [previstoCartao('p1', '2026-04-20', 300)]
  const { itensVisiveis, itensParaSomatorio } = montarProjecao({
    itensBase,
    cartoes: [cartaoA],
    faturasReais: [],
    inicioISO: '2026-04-01',
    fimISO: '2026-04-30',
  })

  // Continua visível na timeline (lista / "Próximos lançamentos").
  assert.equal(itensVisiveis.length, 1)
  assert.equal(itensVisiveis[0].id, 'p1')
  // Nenhuma fatura projetada cai em abril (vencimento da de maio é 10/mai).
  assert.equal(itensVisiveis.filter((i) => i.fatura === true).length, 0)

  // Não aparece no somatório nem no total do período.
  assert.equal(itensParaSomatorio.some((i) => i.id === 'p1'), false)
  const resumo = calcularResumoPlanejamentos(itensParaSomatorio)
  assert.equal(resumo.totais.saidas, 0) // R$ 0: nada sai da conta em abril
})

verificar('P2b — cenário da semana 36: previsto de cartão cuja fatura vence fora da semana NÃO soma', () => {
  // Analogamente ao print: "Seguro do carro" e "Netflix" (destino Cartão) na
  // semana 36, mas a fatura do cartão vence em OUTRA data (fora da semana) —
  // o dinheiro só sai quando a fatura vence e é paga, não no lançamento.
  const itensBase = [
    previstoCartao('seguro', '2026-08-31', 141.15), // compra dia 31/08
    previstoCartao('netflix', '2026-09-02', 44.9), // compra dia 02/09
    itemNormal('agua', '2026-09-04', 120), // conta de água: sai mesmo na semana
  ]
  const { itensVisiveis, itensParaSomatorio } = montarProjecao({
    itensBase,
    // Cartão A: fechamento dia 15 → compra 31/08 e 02/09 caem na fatura de
    // SETEMBRO; vencimento (dia 10/09) cai FORA da faixa da semana 36 (02/09…).
    cartoes: [cartaoA],
    faturasReais: [],
    inicioISO: '2026-08-31',
    fimISO: '2026-09-06', // semana 36: 31/08 a 06/09
  })
  // Timeline mantém os dois previstos visíveis e também a água.
  assert.equal(itensVisiveis.length, 3)
  assert.ok(itensVisiveis.some((i) => i.id === 'seguro'))
  assert.ok(itensVisiveis.some((i) => i.id === 'netflix'))

  // Somatório: a água conta; os previstos de cartão NÃO (fatura fora da semana).
  const idsSomatorio = itensParaSomatorio.map((i) => i.id)
  assert.ok(idsSomatorio.includes('agua'))
  assert.ok(!idsSomatorio.includes('seguro'))
  assert.ok(!idsSomatorio.includes('netflix'))
  const resumo = calcularResumoPlanejamentos(itensParaSomatorio)
  assert.equal(resumo.totais.saidas, 120) // só a água; NÃO 186,05 dos cartões
})

verificar('P3 — total do período não duplica quando há previsto absorvido E item normal', () => {
  // Faixa de maio: previsto absorvido (300) + um item normal (100) não-cartão.
  const itensBase = [
    previstoCartao('p1', '2026-04-20', 300),
    itemNormal('n1', '2026-05-05', 100),
  ]
  const { itensParaSomatorio } = montarProjecao({
    itensBase,
    cartoes: [cartaoA],
    faturasReais: [],
    inicioISO: '2026-05-01',
    fimISO: '2026-05-31',
  })
  const resumo = calcularResumoPlanejamentos(itensParaSomatorio)
  assert.equal(resumo.totais.saidas, 400) // 300 (fatura) + 100 (normal)
})

verificar('P4 — mes com dado real + previsto: fatura tipo real soma os dois sem duplicar', () => {
  // Fatura real de maio (100) + previsto de maio (300) → item real de 400.
  const itensBase = [previstoCartao('p1', '2026-04-20', 300)]
  const { itensParaSomatorio, itensVisiveis } = montarProjecao({
    itensBase,
    cartoes: [cartaoA],
    faturasReais: [{ cartao: cartaoA, mes: '2026-05', valor_restante: 100 }],
    inicioISO: '2026-05-01',
    fimISO: '2026-05-31',
  })
  const fatura = itensVisiveis.find((i) => i.fatura === true)
  assert.equal(fatura.tipo, 'real')
  assert.equal(fatura.valor_real, 100)
  assert.equal(fatura.valor_previsto, 300)
  assert.equal(fatura.valor, 400)
  const resumo = calcularResumoPlanejamentos(itensParaSomatorio)
  assert.equal(resumo.totais.saidas, 400) // uma única vez
})

verificar('P5 — previsto vincula a cartão INATIVO gera fatura projetada (não exige ativo)', () => {
  // O André determinou: não exigir cartão ATIVO — se o cartão existir (mesmo
  // inativo) o previsto de destino cartão deve ser agrupado na projeção.
  const cartaoInativo = { ...cartaoA, nome: 'Susc', ativo: false }
  const itensBase = [previstoCartao('p1', '2026-04-20', 300)]
  const { itensVisiveis, itensParaSomatorio } = montarProjecao({
    itensBase,
    cartoes: [cartaoInativo],
    faturasReais: [],
    inicioISO: '2026-05-01',
    fimISO: '2026-05-31',
  })
  // Fatura projetada aparece mesmo com o cartão inativo.
  const fatura = itensVisiveis.find((i) => i.fatura === true)
  assert.ok(fatura, 'deveria gerar fatura projetada com cartão inativo')
  assert.equal(fatura.tipo, 'projetada')
  assert.equal(fatura.fatura_nome, 'Susc')
  assert.equal(fatura.valor, 300)
  // E o previsto não soma como linha própria (vem só via fatura).
  const resumo = calcularResumoPlanejamentos(itensParaSomatorio)
  assert.equal(resumo.totais.saidas, 300)
})

verificar('P6 — projeção respeita o fechamento e aparece no mês do VENCIMENTO mesmo com compra noutro período', () => {
  // Cenário real do André: Netflix com data_prevista em 31/08 (fim de agosto),
  // cartão fecha dia 15 → fatura de SETEMBRO com vencimento 10/09. Sem os
  // previstos externos, a Projeção não aparecia nem em agosto nem em setembro
  // (furo). Com `previstosCartaoExternos` (todos os previstos de cartão), a
  // fatura projetada passa a constar no período que contém o VENCIMENTO.
  const netflix = previstoCartao('netflix', '2026-08-31', 44.9)

  // Em agosto: o vencimento (10/09) cai fora da faixa → NADA (não soma em agosto,
  // pois o dinheiro só sai quando a fatura vence, em setembro).
  const ago = montarProjecao({
    itensBase: [netflix],
    cartoes: [cartaoA],
    faturasReais: [],
    inicioISO: '2026-08-01',
    fimISO: '2026-08-31',
    previstosCartaoExternos: [netflix],
  })
  assert.equal(ago.itensVisiveis.filter((i) => i.fatura === true).length, 0)
  assert.equal(calcularResumoPlanejamentos(ago.itensParaSomatorio).totais.saidas, 0)

  // Em setembro: mesmo o item previsto (data 31/08) NÃO estando no itensBase,
  // a Projeção aparece (item vencendo 10/09, dentro da faixa de setembro) e soma.
  const set = montarProjecao({
    itensBase: [],
    cartoes: [cartaoA],
    faturasReais: [],
    inicioISO: '2026-09-01',
    fimISO: '2026-09-30',
    previstosCartaoExternos: [netflix],
  })
  const faturaSet = set.itensVisiveis.find((i) => i.fatura === true)
  assert.ok(faturaSet, 'deveria gerar a fatura projetada em setembro (vencimento)')
  assert.equal(faturaSet.tipo, 'projetada')
  assert.equal(faturaSet.data_prevista, '2026-09-10')
  assert.equal(faturaSet.valor, 44.9)
  assert.equal(calcularResumoPlanejamentos(set.itensParaSomatorio).totais.saidas, 44.9)
})

verificar('P7 — previsto dentro do período + externo duplicado não soma duas vezes', () => {
  // O previsto externo NÃO pode duplicar: se o mesmo previsto já está no
  // itensBase do período, a fatura carrega o valor UMA única vez.
  const cartao = { ...cartaoA }
  const itensBase = [previstoCartao('p1', '2026-08-31', 300)]
  // Passa o mesmo previsto também como "externo" — não pode somar 600.
  const { itensParaSomatorio } = montarProjecao({
    itensBase,
    cartoes: [cartao],
    faturasReais: [],
    inicioISO: '2026-09-01',
    fimISO: '2026-09-30',
    previstosCartaoExternos: [previstoCartao('p1', '2026-08-31', 300)],
  })
  assert.equal(calcularResumoPlanejamentos(itensParaSomatorio).totais.saidas, 300)
})

verificar('P8 — modo SEMANA: navegando para a semana do VENCIMENTO a Projeção aparece', () => {
  // Padrão da tela é o modo SEMANA. Seguro (31/08) e Netflix (02/09) têm dia
  // de fechamento que joga a compra para setembro; vencimento 10/09 cai na
  // SEMANA 37 (07/09 a 13/09). Ao navegar para essa semana, a Projeção da
  // fatura DEVE aparecer ali, mesmo os previstos tendo data_prevista em outra
  // semana (a do vencimento é a semana correta de saída do dinheiro).
  const netflix = previstoCartao('netflix', '2026-09-02', 44.9)
  const seguro = previstoCartao('seguro', '2026-08-31', 141.15)
  const { itensVisiveis, itensParaSomatorio } = montarProjecao({
    itensBase: [], // semana 37: os previstos originais NÃO estão nesta semana
    cartoes: [cartaoA], // fechamento 15, vencimento 10
    faturasReais: [],
    inicioISO: '2026-09-07',
    fimISO: '2026-09-13', // semana 37
    previstosCartaoExternos: [netflix, seguro],
  })
  const fatura = itensVisiveis.find((i) => i.fatura === true)
  assert.ok(fatura, 'deveria aparecer a Projeção na semana do vencimento')
  assert.equal(fatura.tipo, 'projetada')
  assert.equal(fatura.data_prevista, '2026-09-10')
  assert.equal(fatura.valor, 186.05) // 44.9 + 141.15
  assert.equal(calcularResumoPlanejamentos(itensParaSomatorio).totais.saidas, 186.05)
})

verificar('P9 — item REALIZADO em cartão NÃO soma como saída do fluxo (só via fatura)', () => {
  // Cenário reportado: Netflix e "Seguro do carro - Mapfre" realizados EM
  // CARTÃO (estado='realizado', lancamento_tipo='compra' — a RPC mantém
  // destino_padrao='cartao' via realizar_planejamento_cartao). A saída
  // de caixa só ocorre no PAGAMENTO da fatura do cartão — nunca como linha
  // própria no fluxo do período.
  const realizedCartao = (id, data, valor) => ({
    id,
    estado: 'realizado',
    lancamento_tipo: 'compra',
    destino_padrao: 'cartao',
    cartao_padrao_id: 'cartao-A',
    data_prevista: data,
    valor,
    tipo_op: 'Saida',
  })
  const itensBase = [
    realizedCartao('netflix', '2026-09-02', 44.9),
    realizedCartao('seguro', '2026-09-02', 141.15),
  ]
  const { itensVisiveis, itensParaSomatorio } = montarProjecao({
    itensBase,
    cartoes: [cartaoA],
    faturasReais: [], // fatura real paga em outra semana/fora desta faixa
    inicioISO: '2026-08-31',
    fimISO: '2026-09-06', // semana 36 (mesma da queixa)
  })

  // Continuam visíveis na timeline (computados como realizados).
  assert.equal(itensVisiveis.length, 2)
  assert.ok(itensVisiveis.some((i) => i.id === 'netflix'))
  assert.ok(itensVisiveis.some((i) => i.id === 'seguro'))

  // Mas NÃO entram no somatório: a saída do fluxo desta semana é R$ 0
  // (nenhuma fatura do cartão vence/paga nesta faixa).
  assert.equal(itensParaSomatorio.length, 0)
  const resumo = calcularResumoPlanejamentos(itensParaSomatorio)
  assert.equal(resumo.totais.saidas, 0) // NÃO 186,05
})

verificar('P10 — em cartão REALIZADO fora da faixa da fatura não soma; dentro da fatura real soma uma vez', () => {
  // O realizado de cartão já está na fatura REAL (v_faturas). Nesta faixa a
  // fatura real do cartão (valor 186,05) aparece e paga; o item realizado NÃO
  // pode somar de novo como linha (senão vira 372,10).
  const realized = {
    id: 'seguro',
    estado: 'realizado',
    lancamento_tipo: 'compra',
    destino_padrao: 'cartao',
    cartao_padrao_id: 'cartao-A',
    data_prevista: '2026-08-31',
    valor: 186.05,
    tipo_op: 'Saida',
  }
  const { itensVisiveis, itensParaSomatorio } = montarProjecao({
    itensBase: [realized],
    cartoes: [cartaoA], // vencimento dia 10
    faturasReais: [{ cartao: cartaoA, mes: '2026-09', valor_restante: 186.05 }],
    inicioISO: '2026-09-01',
    fimISO: '2026-09-30',
  })
  // Timeline: item realizado + a fatura real.
  assert.equal(itensVisiveis.length, 2)
  assert.ok(itensVisiveis.some((i) => i.fatura === true))
  // Somatório: só a fatura (186,05), não 372,10.
  const resumo = calcularResumoPlanejamentos(itensParaSomatorio)
  assert.equal(resumo.totais.saidas, 186.05)
})

console.log(`\n${ok} ok, ${falhou} falharam`)
process.exit(falhou === 0 ? 0 : 1)
