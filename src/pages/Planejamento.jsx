import { useEffect, useMemo, useState } from 'react'
import { usePlanejamentos } from '../hooks/usePlanejamentos'
import { useFaturasPlanejamento } from '../hooks/useFaturasPlanejamento'
import { montarProjecao } from '../lib/faturaProjecao'
import { estilosComuns, hoje } from '../lib/compartilhados'
import { adicionarDiasISO } from '../lib/saldoProjetado'
import { definirPeriodo, deslocarPeriodo, ehPeriodoAtual } from '../lib/periodos'
import { calcularResumoPlanejamentos } from '../lib/planejamentoCalc'
import { useFeriasPlanejamento } from '../hooks/useFeriasPlanejamento'
import { useSaldoProjetado } from '../hooks/useSaldoProjetado'
import SeletorPeriodo from '../components/planejamento/SeletorPeriodo'
import VisaoGeral from '../components/planejamento/VisaoGeral'
import Lancamentos from '../components/planejamento/Lancamentos'

// ============================================================================
// PLANEJAMENTOS — ORQUESTRADOR (ETAPA 06/E5-F4)
// ============================================================================
// A página virou estrutura: SELETOR DE PERÍODO (Semana/Mês/Trimestre/Semestre)
// + ABAS INTERNAS (Visão geral | Lançamentos) — estado local da página, sem
// rotas novas. Ao abrir, a tela padrão é a VISÃO GERAL (resumo primeiro,
// formulário não — correção central desta etapa).
//
// Divisão de responsabilidades:
//   • SEMANA → caminho ÚNICO validado do domínio (listarPorSemana do hook:
//     alvo/itens/totais/contagens prontos). A aritmética de navegação NÃO é
//     duplicada aqui: usa definirPeriodo/deslocarPeriodo de periodos.js;
//   • MÊS/TRIMESTRE/SEMESTRE → consulta explícita listarPorPeriodo(inicio,fim)
//     guardada em estado próprio da página; resumo via calcularResumoPlanejamentos
//     (a MESMA função pura usada pelo hook — nenhuma segunda implementação);
//   • Lançamentos.jsx concentra formulário e ações (comportamento E5-E intacto);
//   • VisaoGeral.jsx exibe resumo, contagens, divisão por mês e próximos.
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
    criarPlanejamento,
    criarSerieParcelada,
    criarSerieRecorrente,
    editarPlanejamento,
    cancelarSerieAPartirDe,
    atualizar,
  } = usePlanejamentos({ ano: semanaInicial.ano, semana: semanaInicial.semana })

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

  const [tipoPeriodo, setTipoPeriodo] = useState('semana')
  const [aba, setAba] = useState('visao') // 'visao' | 'lancamentos'

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
    })
    return res
  }, [itensBase, cartoes, faturasReais, periodoVisivel, previstosCartaoTotal, feriasMarcadas])

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
    listarPorPeriodo,
    cartoes,
    faturasReais,
    previstosCartaoExternos: previstosCartaoTotal,
    ferias: feriasMarcadas,
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

  // Pós-mutação na aba Lançamentos: na SEMANA o hook já recarrega sozinho
  // (atualizar()); nos períodos maiores a página refaz a PRÓPRIA faixa. Erros
  // daqui caem no estado do período — jamais são confundidos com falha da
  // mutação (que já teve sucesso dentro do domínio).
  async function aoPosMutacao() {
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
  }

  return (
    <div style={estilosComuns.conteudo}>
      <header style={{ marginBottom: '1.25rem' }}>
        <h2 style={estilos.titulo}>Planejamentos</h2>
        <p style={estilos.subtitulo}>
          Entradas e despesas planejadas — visão por semana, mês, trimestre, semestre ou ano.
        </p>
      </header>

      <SeletorPeriodo
        tipo={tipoPeriodo}
        periodo={periodoVisivel}
        unidadeAtual={unidadeAtual}
        desabilitado={carregandoVisivel}
        aoTrocarTipo={aoTrocarTipo}
        aoDeslocar={aoDeslocar}
        aoIrParaHoje={aoIrParaHoje}
      />

      {/* Abas internas — estado local da página (sem rotas novas) */}
      <div style={estilos.abas}>
        <button
          type="button"
          onClick={() => setAba('visao')}
          aria-pressed={aba === 'visao'}
          style={{ ...estilos.aba, ...(aba === 'visao' ? estilos.abaAtiva : {}) }}
        >
          Visão geral
        </button>
        <button
          type="button"
          onClick={() => setAba('lancamentos')}
          aria-pressed={aba === 'lancamentos'}
          style={{ ...estilos.aba, ...(aba === 'lancamentos' ? estilos.abaAtiva : {}) }}
        >
          Lançamentos
        </button>
      </div>

      {aba === 'visao' ? (
        <VisaoGeral
          carregando={carregandoVisivel}
          erro={erroVisivel}
          totais={totaisVisiveis}
          contagens={contagensVisiveis}
          itens={itensVisiveis}
          dividirPorMes={!modoSemana}
          aoVerLancamentos={() => setAba('lancamentos')}
          saldoProjetado={saldoAteFimVisivel}
          saldoProjetadoCarregando={saldoProjetado.carregando}
          saldoProjetadoErro={saldoProjetado.erro}
          rotuloPeriodo={rotuloPeriodo}
        />
      ) : (
        <Lancamentos
          itens={itensVisiveis}
          carregando={carregandoVisivel}
          erro={erroVisivel}
          dataPadrao={dataPadrao}
          acoes={{
            criar: criarPlanejamento,
            criarSerie: criarSerieParcelada,
            criarSerieRecorrente,
            cancelar: cancelarPlanejamento,
            cancelarSerie: cancelarSerieAPartirDe,
            excluir: excluirPlanejamento,
            excluirSerie,
            regenerarSerie,
            editar: editarPlanejamento,
            realizar: realizarPlanejamento,
            realizarCartao: realizarPlanejamentoCartao,
            realizarFatura: aoPagarFatura,
          }}
          aoPosMutacao={aoPosMutacao}
        />
      )}

      <p style={estilos.notaEtapa}>
        A realização pode ser feita em conta (RPC realizar_planejamento) ou em
        cartão de crédito (RPC realizar_planejamento_cartao, à vista) pela aba
        Lançamentos.
      </p>
    </div>
  )
}

const estilos = {
  titulo: { margin: 0, fontSize: '1.3rem', fontWeight: 'bold', color: '#e5e7eb' },
  subtitulo: { margin: '0.25rem 0 0', color: '#9ca3af', fontSize: '0.9rem' },
  abas: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.25rem' },
  aba: {
    padding: '0.45rem 1.1rem',
    borderRadius: '999px',
    border: '1px solid #374151',
    background: '#111827',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 'bold',
  },
  abaAtiva: { color: '#42A5F5', borderColor: 'rgba(66, 165, 245, 0.45)' },
  notaEtapa: { marginTop: '1.5rem', color: '#6b7280', fontSize: '0.8rem' },
}
