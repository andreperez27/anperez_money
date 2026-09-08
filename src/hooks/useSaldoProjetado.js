import { useEffect, useMemo, useState } from 'react'
import { hoje } from '../lib/compartilhados'
import {
  adicionarDiasISO,
  calcularSaldoProjetado,
  calcularSaldoReal,
  compararISO,
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
// Projeção em CADEIA a partir do saldo REAL ao fim da véspera do início da
// semana CORRENTE (ex.: saldo em 06/09 p/ a semana 37). Essa base é estável
// (não muda ao navegar entre períodos) e a partir dela a série atravessa os
// lançamentos do início da semana em diante até o horizonte:
//
//   • semana atual   = real(06/09) + resultado previsto da S37;
//   • próxima semana = real(06/09) + resultado(S37) + resultado(S38), ou seja
//     saldo do fim da semana anterior + resultado previsto da seguinte;
//   • ... e assim por diante, semana a semana, pelos 90 dias do horizonte —
//     montando uma projeção mais ampla.
//
// Períodos JÁ ENCERRADOS (fim < início da semana corrente) mostram o saldo
// REAL reconstruído via movimentações — um lançamento feito hoje não retroage
// no número da semana passada.
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
//   • o acumulado usa a lib pura `calcularSaldoProjetado`.
// Cartões, faturas reais, previstos de cartão e férias chegam prontos via props
// (já buscados pela página) — evitando buscas duplicadas.
//
// Exposição: { saldoInicial, baseProjecao, serie, saldoProjetado (no fim da
// faixa), saldoEm(ateISO), horizonte, carregando, erro }
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
  // reconstruir a base da projeção (véspera da semana corrente) e o saldo real
  // de períodos passados.
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

  // Início da semana CORRENTE (segunda 07/09). Toda a projeção parte do saldo
  // real ao fim da VÉSPERA dele (06/09) e atravessa os lançamentos de lá em
  // diante — por isso a busca da série começa na segunda da semana corrente.
  const inicioSemana = useMemo(() => definirPeriodo('semana', inicioISO).inicio, [inicioISO])
  const vesperaDaSemana = adicionarDiasISO(inicioSemana, -1)

  // Saldo REAL de hoje = soma das contas ATIVAS (sem caixinhas — ver cabeçalho).
  const saldoInicial = useMemo(() => {
    const contasAtivas = (contas || []).filter((c) => c.ativa)
    return contasAtivas.reduce((soma, c) => soma + Number(c.saldo_atual), 0)
  }, [contas])

  // Base da projeção: saldo real ao fim da véspera da semana corrente. Quando
  // ainda não carregada (ou sem cobertura/erro) → null → a UI mostra "—".
  const baseProjecao = useMemo(() => {
    if (movReaisCarregando || movReaisErro) return null
    return calcularSaldoReal({
      saldoAtual: saldoInicial,
      movimentacoes: movReais,
      dataAlvo: vesperaDaSemana,
      coberturaMinima,
    })
  }, [movReais, movReaisCarregando, movReaisErro, saldoInicial, vesperaDaSemana, coberturaMinima])

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

  // Acumulado real → saldo dia a dia + saldo ao fim da faixa, partindo da
  // BASE da projeção (real na véspera da semana corrente).
  const projecaoSaldo = useMemo(() => {
    if (baseProjecao === null) return { serie: [], saldoAoFim: null }
    return calcularSaldoProjetado(baseProjecao, projecao.itensParaSomatorio, {
      inicioISO: inicioSemana,
      fimISO,
    })
  }, [baseProjecao, projecao.itensParaSomatorio, inicioSemana, fimISO])

  return {
    saldoInicial,
    baseProjecao,
    saldoProjetado: projecaoSaldo.saldoAoFim,
    serie: projecaoSaldo.serie,
    // Saldo ao fim de `dataISO`.
    // • fim < início da semana corrente → saldo REAL reconstruído (período
    //   fechado: um lançamento de hoje não retroage nele);
    // • a partir da semana corrente → projeção em CADEIA: base real da véspera
    //   + resultado previsto da semana atual, depois da seguinte etc., até o
    //   horizonte de 90 dias.
    saldoEm: (dataISO) => {
      if (compararISO(dataISO, inicioSemana) < 0) {
        if (movReaisCarregando || movReaisErro) return null
        return calcularSaldoReal({
          saldoAtual: saldoInicial,
          movimentacoes: movReais,
          dataAlvo: dataISO,
          coberturaMinima,
        })
      }
      if (baseProjecao === null) return null
      return projecaoSaldo.saldoAteData(projecaoSaldo.serie, dataISO, baseProjecao)
    },
    horizonte: { inicio: inicioSemana, fim: fimISO },
    carregando,
    erro,
  }
}