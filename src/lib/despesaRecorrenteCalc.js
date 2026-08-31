// Despesa mensal de condomínio (ETAPA 06 / gerador) — núcleo de cálculo.
// Função PURA: sem React, sem Supabase, sem fetch — fácil de testar (padrão
// planejamentoCalc/planejamentoSerie: lógica financeira vive numa lib, não no
// componente/hook).
//
// O boleto tem dois grupos:
//   • FIXOS (despesa_recorrente_item): Cota Condominial, Taxa de Coleta,
//     Fundo de Reserva, Leitura, e as séries com contador e fim conhecido
//     (Manut. Pintura PC, Benfeitorias);
//   • VARIÁVEIS (digitadas todo mês): Consumo de Gás e de Água.
// O gerador soma os fixos VIGENTES no mês + os variáveis → total da previsão.
//
// REFERÊNCIA "n/total" (séries): para um item com vigencia_termino definido,
// conta-se a posição do mês perguntado dentro da vigência —
//   n     = (mesAlvo - vigencia_inicio) em meses + 1
//   total = (vigencia_termino - vigencia_inicio) em meses + 1
// ex.: Benfeitorias de JAN/2024 a DEZ/2026 dá "33/36" em SET/2026. Itens sem
// vigencia_termino (sem fim previsto) não têm referência ('').

// Normaliza o mês alvo para { ano, mes } (mes 1–12). Aceita objeto ou 'YYYY-MM'.
function normalizarMes(mesAlvo) {
  if (mesAlvo && typeof mesAlvo === 'object' && mesAlvo.ano && mesAlvo.mes) {
    return { ano: Number(mesAlvo.ano), mes: Number(mesAlvo.mes) }
  }
  if (typeof mesAlvo === 'string' && /^\d{4}-\d{2}$/.test(mesAlvo)) {
    const [ano, mes] = mesAlvo.split('-').map(Number)
    return { ano, mes }
  }
  throw new Error('Mês alvo inválido: use { ano, mes } ou "YYYY-MM".')
}

// Primeiro e último dia do mês como 'YYYY-MM-DD' (para comparar vigências).
function limitesDoMes(ano, mes) {
  const primeiro = `${ano}-${String(mes).padStart(2, '0')}-01`
  const ultimoDia = new Date(ano, mes, 0).getDate()
  const ultimo = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`
  return { primeiro, ultimo }
}

// Meses cheios entre duas datas 'YYYY-MM-DD' (comparando mês/ano). Usa o 1º
// dia de cada mês para o cálculo da posição da série.
function mesesEntre(inicioISO, fimISO) {
  const [ai, mi] = inicioISO.split('-').slice(0, 2).map(Number)
  const [af, mf] = fimISO.split('-').slice(0, 2).map(Number)
  return (af - ai) * 12 + (mf - mi)
}

// Formata número para "R$ 1.234,56" (pt-BR) — usado no texto da observação.
export function formatarMoedaBR(valor) {
  const n = Number(valor)
  const negativo = n < 0
  const centavos = Math.round(Math.abs(n) * 100)
  const inteiro = Math.floor(centavos / 100)
  const dec = String(centavos % 100).padStart(2, '0')
  const milhar = String(inteiro).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${negativo ? '-R$ ' : 'R$ '}${milhar},${dec}`
}

// Calcula total + detalhamento da previsão de condomínio de um mês.
//   • itens: lista de despesa_recorrente_item (fixos). A função FILTRA os
//     vigentes no mês por conta própria (robusta, não depende da origem);
//   • mes: { ano, mes } ou 'YYYY-MM' do mês a prever;
//   • gas/agua: valores variáveis do mês (números, reais).
// Retorna { total, detalhamento } — detalhamento é lista de linhas
// { cod, descricao, valor, referencia, categoria } pronta pra virar a
// observação da previsão.
export function calcularTotalCondominio({ itens = [], mes, gas = 0, agua = 0 }) {
  const alvo = normalizarMes(mes)
  const { primeiro, ultimo } = limitesDoMes(alvo.ano, alvo.mes)

  const detalhamento = []

  for (const item of itens) {
    // Filtro de vigência no mês alvo (mesma regra do hook/banco).
    const inicio = item.vigencia_inicio
    const termino = item.vigencia_termino
    if (inicio && inicio > ultimo) continue
    if (termino && termino < primeiro) continue

    // Referência da série (só quando a vigência tem fim definido).
    let referencia = ''
    if (inicio && termino) {
      const mesAlvoISO = `${alvo.ano}-${String(alvo.mes).padStart(2, '0')}-01`
      const posicao = mesesEntre(inicio, mesAlvoISO) + 1
      const total = mesesEntre(inicio, fimDoMes(termino)) + 1
      if (posicao >= 1 && total >= 1) referencia = `${posicao}/${total}`
    }

    detalhamento.push({
      cod: item.cod,
      descricao: item.descricao,
      valor: Number(item.valor || 0),
      referencia,
      categoria: item.categoria ?? '',
    })
  }

  // Variáveis do mês (Gás e Água) — sempre presentes, valor digitado.
  const gasNum = Number(gas || 0)
  const aguaNum = Number(agua || 0)
  detalhamento.push({ cod: '1010', descricao: 'Consumo de Gás', valor: gasNum, referencia: '', categoria: 'Utilidades' })
  detalhamento.push({ cod: '1052', descricao: 'Consumo de Água', valor: aguaNum, referencia: '', categoria: 'Utilidades' })

  const totalBruto = detalhamento.reduce((soma, linha) => soma + linha.valor, 0)
  // Arredonda para centavos (o script antigo fazia round(total, 2)) — evita
  // 1463.1699999999998 quando a previsão guarda o valor em reais.
  const total = Math.round((totalBruto + Number.EPSILON) * 100) / 100
  return { total, detalhamento }
}

// Muda a data para o fim do mês (dia 28/30/31) — para comparar vigência.
// Devolve 'YYYY-MM-DD' usando limitesDoMes do mês da data informada.
function fimDoMes(iso) {
  const [a, m] = iso.split('-').slice(0, 2).map(Number)
  return limitesDoMes(a, m).ultimo
}

// Gera o TEXTO da observação da previsão, uma linha por item, no formato:
//   "1002 Cota Condominial R$ 840,82"
//   "15002 Manut. Pintura PC 9/24 R$ 170,00"
export function montarObservacaoCondominio(detalhamento) {
  return detalhamento
    .map((linha) => {
      const ref = linha.referencia ? ` ${linha.referencia}` : ''
      return `${linha.cod} ${linha.descricao}${ref} ${formatarMoedaBR(linha.valor)}`
    })
    .join('\n')
}
