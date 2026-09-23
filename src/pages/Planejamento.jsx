import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlanejamentos } from '../hooks/usePlanejamentos'
import { useFaturasPlanejamento } from '../hooks/useFaturasPlanejamento'
import { montarProjecao } from '../lib/faturaProjecao'
import { estilosComuns, hoje } from '../lib/compartilhados'
import { adicionarDiasISO } from '../lib/saldoProjetado'
import { useFeriados } from '../hooks/useFeriados'
import { definirPeriodo, deslocarPeriodo, ehPeriodoAtual } from '../lib/periodos'
import { calcularResumoPlanejamentos } from '../lib/planejamentoCalc'
import { useFeriasPlanejamento } from '../hooks/useFeriasPlanejamento'
import { useSaldoProjetado } from '../hooks/useSaldoProjetado'
import SeletorPeriodo from '../components/planejamento/SeletorPeriodo'
import VisaoGeral from '../components/planejamento/VisaoGeral'
import Lancamentos from '../components/planejamento/Lancamentos'
import CalendarioPlanejamento from '../components/planejamento/CalendarioPlanejamento'

// ============================================================================
// PLANEJAMENTOS — ORQUESTRADOR (ETAPA 06/E5-F4)
// ============================================================================
// A página virou estrutura única (13/09/2026): SELETOR DE PERÍODO
// (Semana/Mês/Trimestre/Semestre) + resumo (cards) + a lista completa do
// período renderizada pelo Lancamentos.jsx — as antigas abas "Visão geral" e
// "Lançamentos" foram unificadas. Ao abrir, o resumo vem primeiro
// (formulário não — correção central desta etapa).
//
// Divisão de responsabilidades:
//   • SEMANA → caminho ÚNICO validado do domínio (listarPorSemana do hook:
//     alvo/itens/totais/contagens prontos). A aritmética de navegação NÃO é
//     duplicada aqui: usa definirPeriodo/deslocarPeriodo de periodos.js;
//   • MÊS/TRIMESTRE/SEMESTRE → consulta explícita listarPorPeriodo(inicio,fim)
//     guardada em estado próprio da página; resumo via calcularResumoPlanejamentos
//     (a MESMA função pura usada pelo hook — nenhuma segunda implementação);
//   • Lancamentos.jsx concentra o botão "+ Novo lançamento", a lista completa
//     com ações ocultas em acordeão (comportamento E5-E intacto nas ações);
//   • VisaoGeral.jsx exibe resumo, contagens e a divisão por mês.
//
// Em 31/08/2026 as abas superiores dedicadas Condomínio e DAS-MEI foram
// REMOVIDAS (decisão com André): os formulários foram consolidados DENTRO do
// modal "Novo planejamento" de Lancamentos.jsx, nas opções [Recorrente] e
// [Condomínio]. Os geradores (GeradorCondominio.jsx, GeradorRecorrenciaMensal.jsx)
// e a lib de média móvel (mediaMovelCalc.js) foram REATIVADOS no modal. Ver
// DIARIO_DE_BORDO.md.
//
// Ao trocar o TIPO de período, a tela volta para o período que contém HOJE
// (previsível e igual à semântica do botão Hoje). "Hoje" nunca desloca dia
// civil por timezone: hoje() é data civil YYYY-MM-DD e periodos.js opera em UTC.
//
// Realização ("Lançar") cobre CONTAS (RPC realizar_planejamento via
// movimentacoes) e CARTÃO (RPC realizar_planejamento_cartao à vista via
// criar_compra, migration 19). O hook usePlanejamentos permanece INTACTO em
// comportamento (novos métodos somam, não alteram os existentes).
// ============================================================================

export default function Planejamento() {
  // Semana INICIAL (só na montagem): quem troca a semana visível é o hook via
  // listarPorSemana — contrato documentado no hook, preservado.
  const [semanaInicial] = useState(() => {
    const atual = definirPeriodo('semana', hoje())
    return { ano: atual.ano, semana: atual.semana }
  })

  const {
    carregando,
    erro,
    itens,
    alvo,
    periodo: periodoSemana,
    listarPorSemana,
    listarPorPeriodo,
    listarPrevistosCartao,
    cancelarPlanejamento,
    excluirPlanejamento,
    excluirSerie,
    regenerarSerie,
    realizarPlanejamento,
    realizarPlanejamentoCartao,
    migrarAtraso,
    criarPlanejamento,
    criarSerieParcelada,
    criarSerieRecorrente,
    editarPlanejamento,
    cancelarSerieAPartirDe,
    salvarConsumoReal,
    lerConsumoMes,
    atualizar,
  } = usePlanejamentos({ ano: semanaInicial.ano, semana: semanaInicial.semana })

  // Ref para estabilizar listarPorPeriodo (identidade muda a cada render do hook)
  const listarPorPeriodoRef = useRef(listarPorPeriodo)
  listarPorPeriodoRef.current = listarPorPeriodo

  // Fatura automática: as faturas reais de todos os meses de cada cartão ativo
  // entram como itens sintéticos (não gravados no banco). Projeção = real +
  // previstos de destino cartão. pagarFatura chama a RPC pagar_fatura do módulo
  // Cartões (sempre só sobre dado real).
  const faturasPlanejamento = useFaturasPlanejamento()
  const { faturasReais, cartoes, pagarFatura, recarregar: recarregarFaturas } = faturasPlanejamento

  // FÉRIAS (fonte da verdade = Ponto). Viraram marcadores sintéticos (R$ 0)
  // na timeline do Planejamento — avisos de data futura, nunca editáveis.
  const feriasPlanejamento = useFeriasPlanejamento()
  const { ferias: feriasMarcadas } = feriasPlanejamento

  // Feriados globais do Ponto — o vencimento REAL da fatura de cartão pula
  // fim de semana E feriado (próximo dia útil), centralizado em diaUtil.
  const { feriados } = useFeriados()

  const [tipoPeriodo, setTipoPeriodo] = useState('semana')
  const [modoVisualizacao, setModoVisualizacao] = useState('lista') // 'lista' | 'calendario'

  // Estado do calendário: mês navegado independentemente do seletor de período
  const [mesCalendario, setMesCalendario] = useState(() => {
    const h = new Date()
    return { ano: h.getFullYear(), mes: h.getMonth() + 1 }
  })
  const [itensCalendario, setItensCalendario] = useState([])
  const [carregandoCalendario, setCarregandoCalendario] = useState(false)
  const [erroCalendario, setErroCalendario] = useState('')

  // Intervalo do mês exibido no calendário (fonte única do efeito de busca
  // abaixo e do pós-mutação em modo calendário).
  function intervaloMesCalendario(mes) {
    const mm = String(mes.mes).padStart(2, '0')
    const fimDia = new Date(Date.UTC(mes.ano, mes.mes, 0)).getUTCDate()
    return {
      inicio: `${mes.ano}-${mm}-01`,
      fim: `${mes.ano}-${mm}-${String(fimDia).padStart(2, '0')}`,
    }
  }

  // Busca dados do mês exibido no calendário (independente do período selecionado na lista)
  useEffect(() => {
    if (modoVisualizacao !== 'calendario') return
    let ativo = true
    const { inicio, fim } = intervaloMesCalendario(mesCalendario)
    setCarregandoCalendario(true)
    setErroCalendario('')
    listarPorPeriodoRef.current(inicio, fim)
      .then((dados) => {
        if (!ativo) return
        setItensCalendario(dados)
      })
      .catch((e) => {
        if (!ativo) return
        setErroCalendario(e.message)
        setItensCalendario([])
      })
      .finally(() => {
        if (ativo) setCarregandoCalendario(false)
      })
    return () => { ativo = false }
  }, [modoVisualizacao, mesCalendario])

  // Contador de mutações para o card "Saldo projetado": qualquer criação/
  // edição/cancelamento/realização incrementa a versão e o hook re-busca os
  // itens do horizonte e as movimentações — o recálculo é automático.
  const [versaoHorizonte, setVersaoHorizonte] = useState(0)
  const avancarVersao = () => setVersaoHorizonte((v) => v + 1)
  const comRecarga = (fn) => (...args) =>
    Promise.resolve(fn(...args)).then((r) => {
      avancarVersao()
      return r
    })

  // Todos os planejamentos 'previsto' de destino Cartão (sem janela). Fonte da
  // PROJEÇÃO da fatura: permite projetar o VENCIMENTO em qualquer período em que
  // ele caia, respeitando o dia_fechamento, mesmo que a compra prevista tenha
  // data_prevista noutra faixa (evita o furo compra/vencimento em períodos distintos).
  const [previstosCartaoTotal, setPrevistosCartaoTotal] = useState([])

  // Período corrente das visões MÊS/TRIMESTRE/SEMESTRE (estado da página).
  const [periodo, setPeriodo] = useState(() => definirPeriodo('mes', hoje()))
  const [itensPeriodo, setItensPeriodo] = useState([])
  const [carregandoPeriodo, setCarregandoPeriodo] = useState(false)
  const [erroPeriodo, setErroPeriodo] = useState('')

  const modoSemana = tipoPeriodo === 'semana'

  // Período VISÍVEL unificado (metadados + faixa) para o seletor. Na SEMANA é
  // reconstruído a partir do hook; nos demais, é o estado da própria página.
  const periodoVisivel = useMemo(() => {
    if (modoSemana) {
      if (!alvo || !periodoSemana) return null
      return {
        tipo: 'semana',
        ano: alvo.ano,
        semana: alvo.semana,
        inicio: periodoSemana.inicio,
        fim: periodoSemana.fim,
      }
    }
    return periodo
  }, [modoSemana, alvo, periodoSemana, periodo])

  // Busca das faixas maiores — caminho EXPLÍCITO listarPorPeriodo. A semana
  // continua pelo mecanismo do hook (efeito próprio); os dois nunca se misturam.
  useEffect(() => {
    if (modoSemana) return undefined
    let ativo = true
    setCarregandoPeriodo(true)
    setErroPeriodo('')
    listarPorPeriodo(periodo.inicio, periodo.fim)
      .then((dados) => {
        if (!ativo) return
        setItensPeriodo(dados)
      })
      .catch((e) => {
        if (!ativo) return
        setErroPeriodo(e.message)
        setItensPeriodo([])
      })
      .finally(() => {
        if (ativo) setCarregandoPeriodo(false)
      })
    return () => {
      ativo = false
    }
    // listarPorPeriodo é uma consulta explícita estável em comportamento;
    // incluí-la nas dependências dispararia recarga a cada render (identidade
    // muda), sem nenhum dado novo.
  }, [modoSemana, periodo]) // eslint-disable-line react-hooks/exhaustive-deps

  // Recarrega os PREVISTOS de destino cartão sempre que o período visível muda
  // (após navegação ou mutação), garantindo que a projeção da fatura esteja atual.
  useEffect(() => {
    let ativo = true
    listarPrevistosCartao()
      .then((dados) => {
        if (ativo) setPrevistosCartaoTotal(dados)
      })
      .catch(() => {
        if (ativo) setPrevistosCartaoTotal([])
      })
    return () => {
      ativo = false
    }
    // listarPrevistosCartao é uma função do hook cuja identidade muda a cada
    // render; incluí-la nas dependências dispararia recarga sem dado novo.
  }, [periodoVisivel]) // eslint-disable-line react-hooks/exhaustive-deps

  const carregandoVisivel = modoSemana ? carregando : carregandoPeriodo
  const erroVisivel = modoSemana ? erro : erroPeriodo
  const itensBase = modoSemana ? itens : itensPeriodo

  // Projeção da FATURA: faz a união do dado real de v_faturas com os
  // planejamentos 'previsto' de destino Cartão (por mês de fatura calculado),
  // gerando um item de fatura por (cartão, mês) dentro do período visível.
  // Retorna os dois arrays:
  //   • itensVisiveis     — timeline/lista (previstos de cartão continuam como
  //                         linha própria + as faturas projetadas).
  //   • itensParaSomatorio — o array que passa em calcularResumoPlanejamentos,
  //                         sem o previsto de cartão absorvido (evita a
  //                         dupla contagem: a fatura já carrega esse valor).
  const { itensVisiveis, itensParaSomatorio } = useMemo(() => {
    if (!periodoVisivel) {
      return { itensVisiveis: itensBase, itensParaSomatorio: itensBase }
    }
    const res = montarProjecao({
      itensBase,
      cartoes,
      faturasReais,
      inicioISO: periodoVisivel.inicio,
      fimISO: periodoVisivel.fim,
      previstosCartaoExternos: previstosCartaoTotal,
      ferias: feriasMarcadas,
      feriados,
      // Referência da fatura FECHADA (22/09/2026): mês fechado vale o real.
      hojeISO: hoje(),
    })
    return res
  }, [itensBase, cartoes, faturasReais, periodoVisivel, previstosCartaoTotal, feriasMarcadas, feriados])

  // Projeção da FATURA também para o CALENDÁRIO: o grid recebe os itens do
  // mês COM os sintéticos de fatura/projeção (mesma régua do modo Lista) —
  // sem isso as faturas não apareciam no calendário.
  const itensVisiveisCalendario = useMemo(() => {
    const { inicio, fim } = intervaloMesCalendario(mesCalendario)
    return montarProjecao({
      itensBase: itensCalendario,
      cartoes,
      faturasReais,
      inicioISO: inicio,
      fimISO: fim,
      previstosCartaoExternos: previstosCartaoTotal,
      ferias: feriasMarcadas,
      feriados,
      // Referência da fatura FECHADA (22/09/2026): mês fechado vale o real.
      hojeISO: hoje(),
    }).itensVisiveis
  }, [mesCalendario, itensCalendario, cartoes, faturasReais, previstosCartaoTotal, feriasMarcadas, feriados])

  // Resumo: SEMPRE via a função pura do domínio sobre o array PARA SOMATÓRIO
  // (que exclui os previstos de cartão absorvidos pela fatura, evitando contar
  // o mesmo valor duas vezes). O array visível (timeline) é só para listar.
  const resumoVisivel = useMemo(
    () => calcularResumoPlanejamentos(itensParaSomatorio),
    [itensParaSomatorio],
  )
  const totaisVisiveis = resumoVisivel.totais
  const contagensVisiveis = resumoVisivel.contagens

  // SALDO ACUMULADO PROJETADO (horizonte de 90 dias a partir de hoje). Sai do
  // saldo REAL atual (contas + caixinhas ativas) e atravessa os planejamentos
  // do horizonte, com a mesma projeção de fatura e as férias do Planejamento.
  const fimHorizonte = useMemo(() => adicionarDiasISO(hoje(), 90), [])
  const saldoProjetado = useSaldoProjetado({
    ateISO: fimHorizonte,
    versaoRecarga: versaoHorizonte,
    listarPorPeriodo,
    cartoes,
    faturasReais,
    previstosCartaoExternos: previstosCartaoTotal,
    ferias: feriasMarcadas,
    feriados,
  })
  // Saldo acumulado até o fim do PERÍODO visível (limitado ao horizonte de 90
  // dias): é o ponto do card "Saldo projetado" ao lado do "Resultado previsto".
  const saldoAteFimVisivel =
    !!periodoVisivel && periodoVisivel.fim <= fimHorizonte
      ? saldoProjetado.saldoEm(periodoVisivel.fim)
      : saldoProjetado.saldoProjetado

  // Texto do detalhe discreto no card combinado: "resultado do {período}".
  const RÓTULO_PERIODO = {
    semana: 'semana',
    mes: 'mês',
    trimestre: 'trimestre',
    semestre: 'semestre',
    ano: 'ano',
  }
  const rotuloPeriodo = RÓTULO_PERIODO[periodoVisivel?.tipo] || RÓTULO_PERIODO[tipoPeriodo] || 'período'

  const unidadeAtual =
    !!periodoVisivel && ehPeriodoAtual(tipoPeriodo, periodoVisivel, hoje())

  // Data padrão dos formulários: início do período visível (ou hoje).
  const dataPadrao = periodoVisivel?.inicio ?? hoje()

  function aoTrocarTipo(novoTipo) {
    if (novoTipo === tipoPeriodo || carregandoVisivel) return
    if (novoTipo === 'semana') {
      setTipoPeriodo('semana')
      const s = definirPeriodo('semana', hoje())
      listarPorSemana(s.ano, s.semana)
    } else {
      setTipoPeriodo(novoTipo)
      setPeriodo(definirPeriodo(novoTipo, hoje()))
      setItensPeriodo([])
      setErroPeriodo('')
    }
  }

  function aoDeslocar(delta) {
    if (!periodoVisivel || carregandoVisivel) return
    if (modoSemana) {
      const novo = deslocarPeriodo('semana', periodoVisivel, delta)
      listarPorSemana(novo.ano, novo.semana)
    } else {
      setPeriodo((p) => deslocarPeriodo(tipoPeriodo, p, delta))
    }
  }

  function aoIrParaHoje() {
    if (carregandoVisivel || unidadeAtual || !periodoVisivel) return
    const destino = definirPeriodo(tipoPeriodo, hoje())
    if (modoSemana) {
      listarPorSemana(destino.ano, destino.semana)
    } else {
      setPeriodo(destino)
    }
  }

  // Pós-mutação na lista integrada: na SEMANA o hook já recarrega sozinho
  // (atualizar()); nos períodos maiores a página refaz a PRÓPRIA faixa; no
  // CALENDÁRIO refaz o mês navegado. Erros daqui caem no estado do período —
  // jamais são confundidos com falha da mutação (que já teve sucesso dentro
  // do domínio).
  async function aoPosMutacao() {
    if (modoVisualizacao === 'calendario') {
      try {
        const { inicio, fim } = intervaloMesCalendario(mesCalendario)
        // Recarrega o mês + os previstos de cartão (fonte da projeção da
        // fatura — sem isso a fatura do calendário fica desatualizada).
        const [dados, previstos] = await Promise.all([
          listarPorPeriodo(inicio, fim),
          listarPrevistosCartao(),
        ])
        setItensCalendario(dados)
        setErroCalendario('')
        setPrevistosCartaoTotal(previstos)
      } catch (e) {
        setErroCalendario(e.message)
      }
      return
    }
    if (modoSemana) return
    try {
      const dados = await listarPorPeriodo(periodo.inicio, periodo.fim)
      setItensPeriodo(dados)
      setErroPeriodo('')
    } catch (e) {
      setErroPeriodo(e.message)
    }
  }

  // Efetivação de um item de FATURA (real): chama a RPC pagar_fatura do módulo
  // Cartões pagando SOMENTE o valor real (valor_real = o que está em v_faturas
  // / fatura_pagamentos), nunca previstos. Depois relê as faturas (a paga sai da
  // projeção e a próxima entra) e os planejamentos.
  async function aoPagarFatura(item) {
    await pagarFatura({
      cartao_id: item.fatura_cartao_id,
      valor: item.valor_real,
      mes_fatura: item.fatura_mes,
      descricao: item.descricao,
    })
    await recarregarFaturas()
    await atualizar()
    avancarVersao()
  }

  // Ações do calendário (memoizadas para evitar re-renders)
  const acoesCalendario = useMemo(() => ({
    criar: comRecarga(criarPlanejamento),
    criarSerie: comRecarga(criarSerieParcelada),
    criarSerieRecorrente: comRecarga(criarSerieRecorrente),
    cancelar: comRecarga(cancelarPlanejamento),
    cancelarSerie: comRecarga(cancelarSerieAPartirDe),
    excluir: comRecarga(excluirPlanejamento),
    excluirSerie: comRecarga(excluirSerie),
    regenerarSerie: comRecarga(regenerarSerie),
    editar: comRecarga(editarPlanejamento),
    realizar: comRecarga(realizarPlanejamento),
    realizarCartao: comRecarga(realizarPlanejamentoCartao),
    migrarAtraso: comRecarga(migrarAtraso),
    realizarFatura: aoPagarFatura,
    salvarConsumoReal: comRecarga(salvarConsumoReal),
    exportarPdf: comRecarga((item) => Promise.resolve()),
  }), [
    comRecarga,
    criarPlanejamento,
    criarSerieParcelada,
    criarSerieRecorrente,
    cancelarPlanejamento,
    cancelarSerieAPartirDe,
    excluirPlanejamento,
    excluirSerie,
    regenerarSerie,
    editarPlanejamento,
    realizarPlanejamento,
    realizarPlanejamentoCartao,
    migrarAtraso,
    aoPagarFatura,
    salvarConsumoReal,
  ])

  return (
    <div style={estilosComuns.conteudo}>
      <header style={{ marginBottom: '1.25rem' }}>
        <h2 style={estilos.titulo}>Planejamentos</h2>
        <p style={estilos.subtitulo}>
          Entradas e despesas planejadas — visão por semana, mês, trimestre, semestre ou ano.
        </p>
      </header>

      {modoVisualizacao !== 'calendario' && (
        <SeletorPeriodo
          tipo={tipoPeriodo}
          periodo={periodoVisivel}
          unidadeAtual={unidadeAtual}
          desabilitado={carregandoVisivel}
          aoTrocarTipo={aoTrocarTipo}
          aoDeslocar={aoDeslocar}
          aoIrParaHoje={aoIrParaHoje}
        />
      )}

      <div style={estilos.toolbar}>
        <div style={estilos.toggleContainer}>
          <button
            type="button"
            onClick={() => setModoVisualizacao('lista')}
            disabled={carregandoVisivel}
            style={{ ...estilos.toggleButton, ...(modoVisualizacao === 'lista' ? estilos.toggleButtonAtivo : {}) }}
          >
            Lista
          </button>
          <button
            type="button"
            onClick={() => setModoVisualizacao('calendario')}
            disabled={carregandoVisivel}
            style={{ ...estilos.toggleButton, ...(modoVisualizacao === 'calendario' ? estilos.toggleButtonAtivo : {}) }}
          >
            Calendário
          </button>
        </div>
      </div>

      {modoVisualizacao === 'calendario' ? (
        <CalendarioPlanejamento
          itens={itensVisiveisCalendario}
          carregando={carregandoCalendario}
          erro={erroCalendario}
          mesAtual={mesCalendario}
          aoMudarMes={setMesCalendario}
          acoes={acoesCalendario}
          aoPosMutacao={aoPosMutacao}
          aoLerConsumoMes={lerConsumoMes}
        />
      ) : (
        <>
          {/* Tela UNIFICADA (13/09/2026): Visão geral e Lançamentos eram abas
              separadas; agora o resumo (cards) vem primeiro e a lista completa
              do período com as ações vem logo abaixo — uma tela só. */}
          <VisaoGeral
        carregando={carregandoVisivel}
        erro={erroVisivel}
        totais={totaisVisiveis}
        contagens={contagensVisiveis}
        itens={itensVisiveis}
        itensParaSomatorio={itensParaSomatorio}
        dividirPorMes={!modoSemana}
        saldoProjetado={saldoAteFimVisivel}
        saldoProjetadoCarregando={saldoProjetado.carregando}
        saldoProjetadoErro={saldoProjetado.erro}
        rotuloPeriodo={rotuloPeriodo}
        inicioISO={periodoVisivel?.inicio}
        fimISO={periodoVisivel?.fim}
        saldoInicioPeriodo={saldoProjetado.saldoAnterior(periodoVisivel?.inicio)}
      />
      <Lancamentos
        itens={itensVisiveis}
        carregando={carregandoVisivel}
        erro={erroVisivel}
        dataPadrao={dataPadrao}
        acoes={{
          criar: comRecarga(criarPlanejamento),
          criarSerie: comRecarga(criarSerieParcelada),
          criarSerieRecorrente: comRecarga(criarSerieRecorrente),
          cancelar: comRecarga(cancelarPlanejamento),
          cancelarSerie: comRecarga(cancelarSerieAPartirDe),
          excluir: comRecarga(excluirPlanejamento),
          excluirSerie: comRecarga(excluirSerie),
          regenerarSerie: comRecarga(regenerarSerie),
          editar: comRecarga(editarPlanejamento),
          realizar: comRecarga(realizarPlanejamento),
          realizarCartao: comRecarga(realizarPlanejamentoCartao),
          migrarAtraso: comRecarga(migrarAtraso),
          realizarFatura: aoPagarFatura,
          salvarConsumoReal: comRecarga(salvarConsumoReal),
        }}
        aoPosMutacao={aoPosMutacao}
        aoLerConsumoMes={lerConsumoMes}
      />
        </>

      )}

      <p style={estilos.notaEtapa}>
        A realização pode ser feita em conta (RPC realizar_planejamento) ou em
        cartão de crédito (RPC realizar_planejamento_cartao, à vista).
      </p>
    </div>
  )
}

const estilos = {
  titulo: { margin: 0, fontSize: '1.3rem', fontWeight: 'bold', color: '#e5e7eb' },
  subtitulo: { margin: '0.25rem 0 0', color: '#9ca3af', fontSize: '0.9rem' },
  notaEtapa: { marginTop: '1.5rem', color: '#6b7280', fontSize: '0.8rem' },
  toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: '1rem' },
  toggleContainer: { display: 'flex', background: '#111827', border: '1px solid #374151', borderRadius: '9px', padding: '3px', gap: '2px' },
  toggleButton: { border: 'none', background: 'transparent', color: '#9ca3af', fontSize: '13px', fontWeight: '600', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', transition: 'background 0.12s ease, color 0.12s ease' },
  toggleButtonAtivo: { background: '#42A5F5', color: '#0b0f19' },
}
