import { useEffect, useMemo, useState } from 'react'
import { hoje } from '../lib/compartilhados'
import {
  adicionarDiasISO,
  calcularSaldoReal,
  compararISO,
  projetarSerie,
} from '../lib/saldoProjetado'
import { montarProjecao } from '../lib/faturaProjecao'
import { definirPeriodo } from '../lib/periodos'
import { useContaAtiva } from '../context/ContaAtivaContext'
import { supabase } from '../lib/supabaseClient'

// Cobertura da busca de movimentações reais usada para reconstruir o saldo de
// períodos passados: 400 dias para trás. Antes disso o card mostra "—".
const COBERTURA_PASSADO_DIAS = 400

// ============================================================================
// SALDO ACUMULADO PROJETADO — hook.
// ============================================================================
// Projeção em CADEIA a partir do saldo REAL de HOJE (não mais da véspera do
// início da semana corrente — correção 11/09/2026): o ponto de partida é o
// saldo real atual das contas e a série soma apenas os lançamentos PREVISTOS
// com data_prevista estritamente maior que hoje (o que já aconteceu já está
// embutido no saldo atual). Isso elimina a inflação do card no meio da semana
// em que a antiga base (véspera) revertia as movimentações REAIS do início da
// semana (Padaria, Enel, pagamento de fatura...) mas a série não as devolvia à
// projeção por não terem item no planejamento.
//
// Encadeamento (preservado): a partir da base, a série atravessa os lançamentos
// previstos do horizonte. Como o ponto de partida é o mesmo para todas as
// janelas, o saldo do fim de uma semana = saldo do fim da anterior + resultado
// previsto da seguinte:
//   • semana atual   = real(hoje) + resultado previsto dos itens futuros;
//   • próxima semana = saldo do fim da semana atual + resultado(S38);
//   • ... pelos 90 dias do horizonte.
//
// Períodos JÁ ENCERRADOS (fim < hoje) mostram o saldo REAL reconstruído via
// movimentações — um lançamento feito hoje não retroage no número de ontem.
// Como o "hoje" muda a cada dia, uma semana em andamento mostra o saldo real
// atual + os previstos que ainda faltam para o fim dela (testes cobrem o meio
// da semana e o início).
//
// IMPORTANTE: a base do saldo são SOMENTE as contas correntes ativas.
// Caixinhas NÃO entram — é dinheiro já reservado para uma meta (troca de carro,
// apê, viagem), não caixa livre para cobrir despesa do dia a dia. Incluí-las
// inflaria o número e esconderia justamente o risco de faltar dinheiro
// disponível, que este card existe para revelar. O card "Patrimônio" da Home
// continua somando conta + caixinha (ali faz sentido); aqui, não.
//
// Reaproveita as MESMAS fontes e a MESMA lógica do Planejamento, sem duplicar:
//   • itens da cadeia vêm de `listarPorPeriodo(inicioSemana, ateISO)`;
//   • a união com faturas de cartão usa `montarProjecao` (regra de não duplicar
//     o previsto de cartão) → `itensParaSomatorio`;
//   • o acumulado usa a lib pura `projetarSerie` (saldo real de hoje + só
//     itens com data_prevista > hoje).
// Cartões, faturas reais, previstos de cartão e férias chegam prontos via props
// (já buscados pela página) — evitando buscas duplicadas.
//
// Exposição: { saldoInicial, serie, saldoProjetado (no fim da faixa),
// saldoEm(ateISO), horizonte, carregando, erro }
// ============================================================================

export function useSaldoProjetado({
  ateISO,
  versaoRecarga = 0,
  listarPorPeriodo,
  cartoes = [],
  faturasReais = [],
  previstosCartaoExternos = [],
  ferias = [],
  feriados = [],
}) {
  const { contas } = useContaAtiva()

  const [itensHorizonte, setItensHorizonte] = useState([])
  const [carregando, setCarregando] = useState(!ateISO)
  const [erro, setErro] = useState(null)

  // Movimentações REAIS das contas ativas (últimos 400 dias) — servem para
  // reconstruir o saldo REAL de PERÍODOS PASSADOS (fim < hoje). Para a
  // projeção (hoje/futuro) o ponto de partida é o saldo atual das contas.
  const idsContasAtivas = useMemo(
    () => (contas || []).filter((c) => c.ativa).map((c) => c.id),
    [contas],
  )
  const [movReais, setMovReais] = useState([])
  const [movReaisCarregando, setMovReaisCarregando] = useState(true)
  const [movReaisErro, setMovReaisErro] = useState(null)

  const inicioISO = hoje()
  const fimISO = ateISO || inicioISO
  const coberturaMinima = adicionarDiasISO(inicioISO, -COBERTURA_PASSADO_DIAS)

  // Início da semana CORRENTE (segunda 07/09). A busca da série começa aqui
  // para atravessar o horizonte INTEIRO (a projeção corta o passado depois:
  // projetarSerie só deixa os itens com data_prevista > hoje), e o
  // montarProjecao usa a mesma régua do Planejamento para gerar as faturas.
  const inicioSemana = useMemo(() => definirPeriodo('semana', inicioISO).inicio, [inicioISO])

  // Saldo REAL de hoje = soma das contas ATIVAS (sem caixinhas — ver cabeçalho).
  // É o PONTO DE PARTIDA da projeção (correção 11/09/2026): o que já aconteceu
  // está embutido aqui; a série soma apenas os previstos de amanhã em diante.
  const saldoInicial = useMemo(() => {
    const contasAtivas = (contas || []).filter((c) => c.ativa)
    return contasAtivas.reduce((soma, c) => soma + Number(c.saldo_atual), 0)
  }, [contas])

  // Busca os planejamentos dentro da janela [inicioSemana, fimISO]: a série
  // precisa começar na segunda da semana corrente para atravessar a janela
  // INTEIRA (07/09..13/09) e seguir semana a semana até o horizonte.
  useEffect(() => {
    if (!ateISO) {
      setItensHorizonte([])
      setCarregando(false)
      return undefined
    }
    let ativo = true
    setCarregando(true)
    setErro(null)
    Promise.resolve(listarPorPeriodo ? listarPorPeriodo(inicioSemana, fimISO) : [])
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
    // render, então fica fora das dependências. `versaoRecarga` é o contador
    // de mutações da página: quando um planejamento é criado/editado/cancelado/
    // realizado, a página incrementa a versão e esta busca refaz (dinâmico).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ateISO, inicioSemana, fimISO, versaoRecarga])

  // Busca as movimentações reais das contas ativas na janela de cobertura.
  // Erro aqui NÃO derruba o card: saldoEm de períodos passados fica null
  // (UI mostra "—") em vez de entregar um número não reconstruído.
  useEffect(() => {
    if (!idsContasAtivas.length) {
      setMovReais([])
      setMovReaisCarregando(false)
      setMovReaisErro(null)
      return undefined
    }
    let ativo = true
    setMovReaisCarregando(true)
    setMovReaisErro(null)
    supabase
      .from('movimentacoes')
      .select('data, tipo_op, valor')
      .in('conta_id', idsContasAtivas)
      .gte('data', coberturaMinima)
      .lte('data', inicioISO)
      .then(({ data, error }) => {
        if (!ativo) return
        if (error) {
          setMovReaisErro(error.message)
          setMovReais([])
        } else {
          setMovReais(data || [])
        }
      })
      .finally(() => {
        if (ativo) setMovReaisCarregando(false)
      })
    return () => {
      ativo = false
    }
  }, [idsContasAtivas, coberturaMinima, inicioISO, versaoRecarga])

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
      inicioISO: inicioSemana,
      fimISO,
      previstosCartaoExternos,
      ferias,
      feriados,
    })
  }, [itensHorizonte, cartoes, faturasReais, inicioSemana, fimISO, previstosCartaoExternos, ferias, feriados])

  // Acumulado real → saldo dia a dia + saldo ao fim da faixa, partindo do
  // saldo REAL de HOJE e somando apenas os itens com data_prevista > hoje.
  const projecaoSaldo = useMemo(() => {
    return projetarSerie({
      saldoAtual: saldoInicial,
      itens: projecao.itensParaSomatorio,
      inicioISO,
      fimISO,
    })
  }, [saldoInicial, projecao.itensParaSomatorio, inicioISO, fimISO])

  return {
    saldoInicial,
    saldoProjetado: projecaoSaldo.saldoAoFim,
    serie: projecaoSaldo.serie,
    // Saldo ao fim de `dataISO`.
    // • fim < hoje → saldo REAL reconstruído (período fechado: um lançamento
    //   feito hoje não retroage nele);
    // • fim >= hoje → projeção em CADEIA a partir do saldo real ATUAL de hoje,
    //   somando só os previstos de amanhã em diante (correção 11/09/2026 — a
    //   antiga base da véspera reverteu avulsas reais do início da semana que a
    //   série não devolvia, inflando o card). O encadeamento semana a semana é
    //   preservado: saldo do fim da semana atual + resultado previsto da seguinte.
    saldoEm: (dataISO) => {
      if (compararISO(dataISO, inicioISO) < 0) {
        if (movReaisCarregando || movReaisErro) return null
        return calcularSaldoReal({
          saldoAtual: saldoInicial,
          movimentacoes: movReais,
          dataAlvo: dataISO,
          coberturaMinima,
        })
      }
      if (carregando || erro) return null
      return projecaoSaldo.saldoAteData(projecaoSaldo.serie, dataISO, saldoInicial)
    },
    horizonte: { inicio: inicioSemana, fim: fimISO },
    carregando,
    erro,
  }
}