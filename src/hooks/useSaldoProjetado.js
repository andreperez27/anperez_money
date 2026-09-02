import { useEffect, useMemo, useState } from 'react'
import { hoje } from '../lib/compartilhados'
import { adicionarDiasISO, calcularSaldoProjetado } from '../lib/saldoProjetado'
import { montarProjecao } from '../lib/faturaProjecao'
import { useContaAtiva } from '../context/ContaAtivaContext'

// ============================================================================
// SALDO ACUMULADO PROJETADO — hook.
// ============================================================================
// Projeta a posição de caixa esperada partindo do saldo REAL de hoje e
// atravessando os lançamentos planejados até `ateISO` (horizonte de 90 dias).
//
// IMPORTANTE: a base do saldo inicial são SOMENTE as contas correntes ativas.
// Caixinhas NÃO entram — é dinheiro já reservado para uma meta (troca de carro,
// apê, viagem), não caixa livre para cobrir despesa do dia a dia. Incluí-las
// inflaria o número e esconderia justamente o risco de faltar dinheiro
// disponível, que este card existe para revelar. O card "Patrimônio" da Home
// continua somando conta + caixinha (ali faz sentido); aqui, não.
//
// Reaproveita as MESMAS fontes e a MESMA lógica do Planejamento, sem duplicar:
//   • itens do horizonte vêm de `listarPorPeriodo(hoje, ateISO)` (usePlanejamentos);
//   • a união com faturas de cartão usa `montarProjecao` (regra de não duplicar
//     o previsto de cartão) → `itensParaSomatorio`;
//   • o acumulado usa a lib pura `calcularSaldoProjetado`.
// Cartões, faturas reais, previstos de cartão e férias chegam prontos via props
// (já buscados pela página) — evitando buscas duplicadas.
//
// Exposição: { saldoInicial, serie, saldoProjetado (no fim da faixa),
// saldoEm(ateISO), carregando, erro }
// ============================================================================

export function useSaldoProjetado({
  ateISO,
  listarPorPeriodo,
  cartoes = [],
  faturasReais = [],
  previstosCartaoExternos = [],
  ferias = [],
}) {
  const { contas } = useContaAtiva()

  const [itensHorizonte, setItensHorizonte] = useState([])
  const [carregando, setCarregando] = useState(!ateISO)
  const [erro, setErro] = useState(null)

  const inicioISO = hoje()
  const fimISO = ateISO || inicioISO

  // Saldo REAL de hoje = soma das contas ATIVAS (sem caixinhas — ver cabeçalho).
  const saldoInicial = useMemo(() => {
    const contasAtivas = (contas || []).filter((c) => c.ativa)
    return contasAtivas.reduce((soma, c) => soma + Number(c.saldo_atual), 0)
  }, [contas])

  // Busca os planejamentos dentro do horizonte [hoje, fimISO].
  useEffect(() => {
    if (!ateISO) {
      setItensHorizonte([])
      setCarregando(false)
      return undefined
    }
    let ativo = true
    setCarregando(true)
    setErro(null)
    Promise.resolve(listarPorPeriodo ? listarPorPeriodo(inicioISO, fimISO) : [])
      .then((dados) => {
        if (!ativo) return
        setItensHorizonte(dados || [])
      })
      .catch((e) => {
        if (!ativo) return
        setErro(e.message)
        setItensHorizonte([])
      })
      .finally(() => {
        if (ativo) setCarregando(false)
      })
    return () => {
      ativo = false
    }
    // listarPorPeriodo é estável em comportamento; identidade muda a cada
    // render, então fica fora das dependências.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ateISO, inicioISO, fimISO])

  // Projeta a fatura de cartão sobre os itens do horizonte e devolve o que
  // realmente soma (itensParaSomatorio). As férias já entram no visível por
  // montarProjecao (R$ 0), mas não alteram o somatório nem o saldo.
  const projecao = useMemo(() => {
    if (!itensHorizonte.length) {
      return { itensParaSomatorio: [] }
    }
    return montarProjecao({
      itensBase: itensHorizonte,
      cartoes,
      faturasReais,
      inicioISO,
      fimISO,
      previstosCartaoExternos,
      ferias,
    })
  }, [itensHorizonte, cartoes, faturasReais, inicioISO, fimISO, previstosCartaoExternos, ferias])

  // Acumulado real → saldo dia a dia + saldo ao fim da faixa.
  const projecaoSaldo = useMemo(() => {
    return calcularSaldoProjetado(saldoInicial, projecao.itensParaSomatorio, {
      inicioISO,
      fimISO,
    })
  }, [saldoInicial, projecao.itensParaSomatorio, inicioISO, fimISO])

  return {
    saldoInicial,
    saldoProjetado: projecaoSaldo.saldoAoFim,
    serie: projecaoSaldo.serie,
    saldoEm: (dataISO) => projecaoSaldo.saldoAteData(projecaoSaldo.serie, dataISO, saldoInicial),
    horizonte: { inicio: inicioISO, fim: fimISO },
    carregando,
    erro,
  }
}