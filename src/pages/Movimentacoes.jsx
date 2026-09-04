import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'
import { useContas } from '../hooks/useContas'
import {
  useMovimentacoes,
  buscarSaldoAntesDe,
  buscarEfeitoApos,
  buscarAberturaDaJanela,
} from '../hooks/useMovimentacoes'
import { useTransferencias } from '../hooks/useTransferencias'
import { useContaAtiva } from '../context/ContaAtivaContext'
import useMediaQuery from '../hooks/useMediaQuery'
import SeletorPeriodo from '../components/SeletorPeriodo'
import ModalFormulario from '../components/ModalFormulario'
import { estilosComuns, formatarData, formatoReal, hoje, dataCivil } from '../lib/compartilhados'
import { resumirMovimentacoes, saldoNoFimDoPeriodo, saldosProgressivos } from '../lib/extratoCalc'

// Datas (ISO yyyy-mm-dd) do mês corrente deslocado de `deslocamento`
// (0 = atual, -1 = anterior). MesAtual termina HOJE; MesAnterior vai até
// o último dia do mês. Data CIVIL por componentes locais (dataCivil) —
// toISOString() aqui deslocaria o dia à noite no UTC−3.
function inicioDoMes(deslocamento = 0) {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + deslocamento)
  return dataCivil(d)
}

function fimDoMes(deslocamento = 0) {
  const d = new Date()
  d.setMonth(d.getMonth() + deslocamento + 1)
  d.setDate(0)
  return dataCivil(d)
}

// Tela de Extrato/Movimentações da conta ativa (estilo do app antigo):
// o foco é a LISTA — os 10 últimos por padrão, com seletor de período
// (mês atual/anterior/personalizado), resumo do período e saldo de
// abertura. O formulário de nova movimentação fica escondido atrás do
// botão flutuante, para não roubar a cena.
//
// Tudo filtra na conta ativa do contexto (useMovimentacoes recebe o id);
// trocar de conta nas pílulas do cabeçalho recarrega o extrato sozinho.
export default function Movimentacoes() {
  const { atualizar } = useContas()
  const { contaAtiva, contas, carregando: contasCarregando } = useContaAtiva()

  const [periodo, setPeriodo] = useState('ultimos10')
  const [personalizado, setPersonalizado] = useState({ dataInicio: '', dataFim: '' })

  // Traduz o período escolhido em filtros para o hook.
  const filtros = useMemo(() => {
    const base = { contaId: contaAtiva?.id }
    if (periodo === 'ultimos10') return { ...base, limite: 10 }
    if (periodo === 'mesAtual') {
      return { ...base, dataInicio: inicioDoMes(0), dataFim: hoje() }
    }
    if (periodo === 'mesAnterior') {
      return { ...base, dataInicio: inicioDoMes(-1), dataFim: fimDoMes(-1) }
    }
    // Personalizado incompleto: aplica só os filtros preenchidos. Se
    // nenhum foi escolhido, o sentinela abaixo faz a lista ficar vazia
    // (o hook só aplica filtros com valor preenchido, nunca datas
    // inválidas como '0000-01-01').
    const temInicio = !!personalizado.dataInicio
    const temFim = !!personalizado.dataFim
    if (!temInicio && !temFim) {
      return { ...base, dataInicio: '9999-12-31' }
    }
    return {
      ...base,
      dataInicio: temInicio ? personalizado.dataInicio : null,
      dataFim: temFim ? personalizado.dataFim : null,
    }
  }, [periodo, personalizado.dataInicio, personalizado.dataFim, contaAtiva?.id])

  const { movimentacoes, carregando, erro, criarMovimentacao, editarMovimentacao, excluirMovimentacao, atualizar: atualizarLista, moverMovimentacaoNoDia } =
    useMovimentacoes(filtros)
  const { excluir: excluirTransferenciaRpc } = useTransferencias()
  const navigate = useNavigate()

  // Saldo de abertura: soma das movimentações ANTES do período (só
  // existe quando o filtro tem data de início). O "pulso" força o
  // recálculo depois de editar/excluir um lançamento (que pode ter
  // mudado a soma antes do período).
  const [saldoAbertura, setSaldoAbertura] = useState(null)
  const [pulsoAbertura, setPulsoAbertura] = useState(0)
  useEffect(() => {
    let ativo = true
    setSaldoAbertura(null)
    if (!filtros.dataInicio || filtros.dataInicio === '9999-12-31') return

    buscarSaldoAntesDe({ contaId: filtros.contaId, data: filtros.dataInicio })
      .then((valor) => {
        if (ativo) setSaldoAbertura(valor)
      })
      .catch(() => {
        if (ativo) setSaldoAbertura(null)
      })
    return () => {
      ativo = false
    }
  }, [filtros.contaId, filtros.dataInicio, pulsoAbertura])

  // Resumo do período em 4 conceitos separados (extratoCalc): Entradas e
  // Saídas são fluxo financeiro real; Transferências é patrimonial líquido
  // (recebidas − enviadas) — fora de Entradas/Saídas MAS dentro do saldo;
  // MOVIMENTO = entradas − saídas + transferências (NÃO é saldo!).
  const resumo = useMemo(() => resumirMovimentacoes(movimentacoes), [movimentacoes])

  // Abertura da JANELA "Últimos 10" (modo sem datas): a lista é o topo da
  // ordenação (data desc, criado_em desc, id asc), então a abertura é o
  // efeito de tudo ANTES da última linha exibida — inclusive linhas do
  // mesmo dia cortadas pelo limite. Lista com menos de 10 linhas cobre o
  // histórico inteiro → abertura zero.
  const [aberturaJanela, setAberturaJanela] = useState(null)
  useEffect(() => {
    let ativo = true
    setAberturaJanela(null)
    if (periodo !== 'ultimos10' || !filtros.contaId) return
    if (carregando) return
    if (movimentacoes.length === 0) {
      setAberturaJanela(0)
      return
    }
    if (movimentacoes.length < 10) {
      setAberturaJanela(0)
      return
    }
    buscarAberturaDaJanela({ contaId: filtros.contaId, ultimaLinha: movimentacoes[movimentacoes.length - 1] })
      .then((valor) => {
        if (ativo) setAberturaJanela(valor)
      })
      .catch(() => {
        if (ativo) setAberturaJanela(null)
      })
    return () => {
      ativo = false
    }
  }, [periodo, filtros.contaId, carregando, movimentacoes, pulsoAbertura])

  // Abertura efetiva: por datas (mês atual/anterior/personalizado) ou pela
  // janela (Últimos 10). Alimenta abertura + fim do período na tela.
  const aberturaEfetiva = periodo === 'ultimos10' ? aberturaJanela : saldoAbertura

  // Efeito das movimentações FUTURAS ao período (data > dataFim): o trigger
  // aplica saldo na hora, então elas já estão no saldo_atual mas fora da
  // pesquisa. O aviso explica a diferença entre "saldo no fim do período"
  // e "saldo atual" sem mascarar nada. Só faz sentido com data de fim.
  const [efeitoFuturo, setEfeitoFuturo] = useState(null)
  useEffect(() => {
    let ativo = true
    setEfeitoFuturo(null)
    if (!filtros.contaId || !filtros.dataFim) return

    buscarEfeitoApos({ contaId: filtros.contaId, data: filtros.dataFim })
      .then((r) => {
        if (ativo) setEfeitoFuturo(r)
      })
      .catch(() => {
        if (ativo) setEfeitoFuturo(null)
      })
    return () => {
      ativo = false
    }
  }, [filtros.contaId, filtros.dataFim, pulsoAbertura])

  // SALDO NO FIM DO PERÍODO = abertura + entradas − saídas + transferências
  // (abertura da JANELA em "Últimos 10", abertura por datas nos demais).
  // Derivado das linhas do extrato — NUNCA copiado do saldo_atual.
  const saldoFimPeriodo = saldoNoFimDoPeriodo(aberturaEfetiva, resumo)

  // Validação automática de reconciliação: quando NÃO existe linha após o
  // fim da pesquisa, o saldo calculado TEM que bater com o saldo_atual da
  // conta (autoridade = trigger). Na janela "Últimos 10" nunca há linha
  // depois dela (ela contém as mais recentes). Se divergir, registra
  // alerta no console — nunca corrige nem esconde (mascarar é proibido).
  useEffect(() => {
    if (aberturaEfetiva === null || !contaAtiva) return
    if (periodo !== 'ultimos10') {
      if (!efeitoFuturo || efeitoFuturo.quantidade > 0) return
    }
    const emCentavos =
      Math.round(saldoFimPeriodo * 100) - Math.round(Number(contaAtiva.saldo_atual) * 100)
    if (emCentavos !== 0) {
      console.warn(
        '[RECONCILIAÇÃO] Sem lançamentos futuros, saldo no fim do período deveria',
        'igualar o saldo_atual e divergiu por', emCentavos, 'centavos.',
        { calculado: saldoFimPeriodo, saldoAtual: contaAtiva.saldo_atual },
      )
    }
  }, [periodo, aberturaEfetiva, efeitoFuturo, saldoFimPeriodo, contaAtiva])

  // Apresentação estilo extrato bancário (Data | Histórico | Débito |
  // Crédito | Saldo): lista na ordem do banco — MAIS RECENTE primeiro —
  // com o SALDO FINAL DO PERÍODO no topo e o SALDO DE ABERTURA no pé
  // (antes da linha mais antiga). O saldo progressivo de cada linha é o
  // saldo real da conta APÓS aquela movimentação, calculado por
  // saldosProgressivos em centavos a partir da abertura validada — o Map
  // é por id, então serve na mesma ordem em que a lista for exibida.
  // Enquanto a abertura não chega do banco, a coluna mostra '—'.
  const saldosLinha = useMemo(
    () => saldosProgressivos(movimentacoes, aberturaEfetiva),
    [movimentacoes, aberturaEfetiva],
  )

  const [mostrandoNova, setMostrandoNova] = useState(false)
  const [movEmEdicao, setMovEmEdicao] = useState(null)
  const esMovil = useMediaQuery('(max-width: 640px)')
  const [tipoOp, setTipoOp] = useState('Entrada')
  const [valor, setValor] = useState('')
  const [descricao, setDescricao] = useState('')
  const [categoria, setCategoria] = useState('')
  const [data, setData] = useState(hoje)
  const [enviando, setEnviando] = useState(false)
  const [mensagem, setMensagem] = useState(null)

  const personalizadoIncompleto =
    periodo === 'personalizado' &&
    (!personalizado.dataInicio || !personalizado.dataFim)

  // Abre o formulário vazio (nova movimentação) e limpa qualquer edição.
  function abrirFormularioNova() {
    setMovEmEdicao(null)
    setValor('')
    setDescricao('')
    setCategoria('')
    setData(hoje)
    setTipoOp('Entrada')
    setMensagem(null)
    setMostrandoNova(true)
  }

  // "Editar" em um lançamento: o MESMO formulário, pré-preenchido.
  // O submit continua chamando o mesmo handler, que decide entre
  // criarMovimentacao e editarMovimentacao pelo campo movEmEdicao.
  function iniciarEdicao(mov) {
    setMovEmEdicao(mov)
    setTipoOp(mov.tipo_op)
    setValor(String(mov.valor))
    setDescricao(mov.descricao)
    setCategoria(mov.categoria || '')
    setData(mov.data)
    setMensagem(null)
    setMostrandoNova(true)
  }

  // Submit do formulário: cria OU edita, depende de movEmEdicao.
  async function handleSalvarMovimentacao(e) {
    e.preventDefault()
    setEnviando(true)
    setMensagem(null)

    const dados = {
      conta_id: contaAtiva.id,
      data,
      descricao: descricao.trim(),
      valor: Number(valor),
      categoria: categoria.trim() || null,
      tipo_op: tipoOp,
    }

    try {
      if (movEmEdicao) {
        // Trigger do banco reverte o efeito antigo e aplica o novo no
        // saldo_atual, na mesma transação.
        await editarMovimentacao(movEmEdicao.id, dados)
        // Volta o formulário ao modo "nova movimentação" mas mantém o
        // formulário aberto para a mensagem de sucesso continuar visível.
        setMovEmEdicao(null)
        setValor('')
        setDescricao('')
        setCategoria('')
        setData(hoje)
        setTipoOp('Entrada')
      } else {
        await criarMovimentacao(dados)
        setValor('')
        setDescricao('')
        setCategoria('')
      }
      // Saldo/abertura refletem o banco pós-trigger.
      await atualizar()
      setPulsoAbertura((p) => p + 1)
      setMensagem({
        tipo: 'ok',
        texto: movEmEdicao
          ? 'Movimentação editada (saldo ajustado automaticamente).'
          : `${tipoOp === 'Entrada' ? 'Entrada' : 'Saída'} de ${formatoReal.format(Number(valor))} lançada em ${contaAtiva.nome}.`,
      })
      // Em sucesso, fecha o modal (padrão aprovado); em erro permanece aberto.
      setMostrandoNova(false)
      setMovEmEdicao(null)
    } catch (err) {
      setMensagem({
        tipo: 'erro',
        texto: movEmEdicao
          ? `Não foi possível editar: ${err.message}`
          : `Não foi possível lançar: ${err.message}`,
      })
    } finally {
      setEnviando(false)
    }
  }

  // "Excluir": confirma com o usuário; o trigger revolta o efeito no
  // saldo (Entrada subtrai, Saída soma de volta) na mesma transação.
  async function handleExcluir(mov) {
    if (!window.confirm(`Excluir "${mov.descricao}" de ${formatarData(mov.data)}?`)) return
    setMensagem(null)
    try {
      await excluirMovimentacao(mov.id)
      await atualizar()
      setPulsoAbertura((p) => p + 1)
      setMensagem({ tipo: 'ok', texto: 'Movimentação excluída (saldo ajustado automaticamente).' })
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: `Não foi possível excluir: ${err.message}` })
    }
  }

  // "Reordenar dentro do dia" (ETAPA 07 do Extrato): a RPC
  // mover_movimentacao_no_dia troca a posição do lançamento com o vizinho do
  // MESMO DIA (↑ sobe, ↓ desce). Só muda a ordem de exibição — o saldo
  // progressivo recomputa porque o próprio método recarrega a lista com os
  // filtros vigentes. O saldo_de_abertura não muda (são as mesmas linhas), por
  // isso não damos pulsoAbertura aqui.
  async function handleMoverDia(mov, sentido) {
    setMensagem(null)
    try {
      await moverMovimentacaoNoDia(mov.id, sentido)
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: `Não foi possível reordenar: ${err.message}` })
    }
  }

  // "Excluir" numa linha de transferência: RPC excluir_transferencia apaga
  // as duas movimentações e o registro, revertendo os dois saldos. Sem rastro.
  async function handleExcluirTransferencia(mov) {
    if (
      !window.confirm(
        `Excluir a transferência "${mov.descricao}" de ${formatoReal.format(Number(mov.valor))}? Os saldos das duas contas serão revertidos.`,
      )
    ) {
      return
    }
    setMensagem(null)
    try {
      await excluirTransferenciaRpc(mov.transferencia_id)
      await atualizarLista()
      await atualizar()
      setPulsoAbertura((p) => p + 1)
      setMensagem({ tipo: 'ok', texto: 'Transferência excluída (saldos revertidos nas duas contas).' })
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: `Não foi possível excluir a transferência: ${err.message}` })
    }
  }

  // "Editar" numa transferência = remover e reabrir o formulário em Contas
  // Correntes pré-preenchido (modelo decidido: não existe edição parcial).
  async function handleEditarTransferencia(mov) {
    setMensagem(null)
    const { data: transf, error } = await supabase
      .from('transferencias')
      .select('*')
      .eq('id', mov.transferencia_id)
      .single()
    if (error || !transf) {
      setMensagem({ tipo: 'erro', texto: 'Não foi possível carregar os dados da transferência.' })
      return
    }
    if (!window.confirm('A transferência será removida e o formulário abrirá preenchido para você ajustar e relançar.')) {
      return
    }
    try {
      await excluirTransferenciaRpc(transf.id)
      navigate('/contas', {
        state: {
          prefillTransferencia: {
            origemId: transf.conta_origem_id,
            destinoId: transf.conta_destino_id,
            valor: String(Number(transf.valor)),
            data: transf.data,
            descricao: transf.descricao || '',
          },
        },
      })
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: `Não foi possível editar a transferência: ${err.message}` })
    }
  }

  return (
    <div style={{ ...estilosComuns.conteudo, fontSize: '0.85rem' }}>
      {contasCarregando && <p style={estilosComuns.mensagem}>Carregando contas...</p>}

      {!contasCarregando && contas.length === 0 && (
        <div>
          <p style={estilosComuns.mensagem}>
            Cadastre uma conta primeiro para ver o extrato.
          </p>
          <Link to="/contas" style={estilosComuns.link}>Ir para Contas</Link>
        </div>
      )}

      {!contasCarregando && contas.length > 0 && (
        <>
          <section style={estilosComuns.secao}>
            <div style={estilos.topo}>
              <h2 style={{ margin: 0 }}>
                Extrato{contaAtiva ? ` · ${contaAtiva.nome}` : ''}
              </h2>
              {contaAtiva && (
                <span style={estilos.badge}>Conta ativa</span>
              )}
            </div>

            {/* Filtros e saldo na mesma linha: pílulas de período à
                esquerda, SALDO ATUAL empurrado para a direita (quebra
                para baixo só quando não cabe, ex.: telas estreitas). */}
            <div style={estilos.filtroLinha}>
              <div style={estilos.filtroPilulas}>
                <SeletorPeriodo
                  valor={periodo}
                  aoTrocarPeriodo={setPeriodo}
                  dataInicio={personalizado.dataInicio}
                  dataFim={personalizado.dataFim}
                  aoTrocarDataInicio={(v) => setPersonalizado((p) => ({ ...p, dataInicio: v }))}
                  aoTrocarDataFim={(v) => setPersonalizado((p) => ({ ...p, dataFim: v }))}
                />
              </div>
              {contaAtiva && (
                <span style={estilos.saldoNaLinha}>
                  Saldo Atual{' '}
                  <strong style={estilos.saldoNaLinhaValor}>
                    {formatoReal.format(Number(contaAtiva.saldo_atual))}
                  </strong>
                </span>
              )}
            </div>
          </section>

          <section style={estilosComuns.secao}>
            {carregando && <p style={estilosComuns.mensagem}>Carregando movimentações...</p>}

            {!carregando && erro && (
              <p style={estilosComuns.erro}>
                Não foi possível carregar as movimentações: {erro}
              </p>
            )}

            {!carregando && personalizadoIncompleto && (
              <p style={estilosComuns.mensagem}>
                Escolha as datas de início e fim para ver o extrato.
              </p>
            )}

            {!carregando && !erro && !personalizadoIncompleto && (
              <>
                {movimentacoes.length === 0 ? (
                  <p style={estilosComuns.mensagem}>
                    Nenhuma movimentação{periodo === 'ultimos10' ? ' ainda' : ' neste período'}.
                  </p>
                ) : (
                  <>
                    {/* Aviso discreto de lançamentos futuros (o SALDO ATUAL
                        foi para a linha dos filtros). Entradas/Saídas/
                        transferências/movimento continuam calculados no
                        código para reconciliação e validação automática. */}
                    {efeitoFuturo !== null && efeitoFuturo.quantidade > 0 && (
                      <div style={estilos.barraResumo}>
                        <span style={estilos.avisoFuturoInline} role="status">
                          ⏳{' '}
                          {efeitoFuturo.quantidade === 1
                            ? '1 lançamento futuro altera o saldo atual em'
                            : `${efeitoFuturo.quantidade} lançamentos futuros alteram o saldo atual em`}{' '}
                          {efeitoFuturo.liquido < 0 ? '−' : '+'}
                          {formatoReal.format(Math.abs(efeitoFuturo.liquido))}.
                        </span>
                      </div>
                    )}

                    {/* Cabeçalho do extrato (desktop): Data | Histórico |
                        Valor (+ verde crédito / − vermelho débito) | Saldo
                        (+ Ações). No celular cada linha vira cartão
                        empilhado, sem scroll horizontal. */}
                    {!esMovil && (
                      <div style={estilos.tabelaCabecalho}>
                        <span style={estilos.gradeCabecalho}>Data</span>
                        <span style={{ ...estilos.gradeCabecalho, borderLeft: '1px solid #374151', textAlign: 'left' }}>
                          Histórico
                        </span>
                        <span style={{ ...estilos.gradeCabecalho, borderLeft: '1px solid #374151', textAlign: 'right' }}>
                          Valor
                        </span>
                        <span style={{ ...estilos.gradeCabecalho, borderLeft: '1px solid #374151', textAlign: 'right' }}>
                          Saldo
                        </span>
                        <span style={{ ...estilos.gradeCabecalho, borderLeft: '1px solid #374151' }} />
                      </div>
                    )}

                    <ul style={estilos.listaExtrato}>
                      {/* Linha do topo: SALDO FINAL DO PERÍODO — valor JÁ
                          validado pela reconciliação; nunca recalculado. No
                          extrato "mais recente primeiro" ele abre a lista.
                          Data = fim do período ou da linha mais recente. */}
                      {(() => {
                        if (saldoFimPeriodo === null) return null
                        const dataFim =
                          filtros.dataFim || movimentacoes[0]?.data || ''
                        return esMovil ? (
                          <li key="saldo-final" style={{ ...estilos.cardMovil, ...estilos.cardFinal }}>
                            <div style={estilos.cardMovilTopo}>
                              <span style={{ ...estilos.rotuloEspecial, color: '#e5e7eb' }}>
                                SALDO FINAL DO PERÍODO
                              </span>
                              <span style={estilos.cardMovilData}>{formatarData(dataFim)}</span>
                            </div>
                            <div style={estilos.cardMovilValor}>
                              <span style={estilos.cardMovilRotulo}>Saldo</span>
                              <strong style={{ ...corDoSaldo(saldoFimPeriodo), fontWeight: 'bold' }}>
                                {formatoReal.format(saldoFimPeriodo)}
                              </strong>
                            </div>
                          </li>
                        ) : (
                          <li key="saldo-final" style={{ ...estilos.tabelaLinha, ...estilos.linhaFinal }}>
                            <span style={estilos.celulaData}>{formatarData(dataFim)}</span>
                            <span style={estilos.celulaDescricao}>
                              <span style={{ ...estilos.rotuloEspecial, color: '#e5e7eb' }}>
                                SALDO FINAL DO PERÍODO
                              </span>
                            </span>
                            <span style={estilos.celulaValor} />
                            <span style={{ ...estilos.celulaSaldo, ...corDoSaldo(saldoFimPeriodo) }}>
                              {formatoReal.format(saldoFimPeriodo)}
                            </span>
                            <span style={estilos.celulaAcoes} />
                          </li>
                        )
                      })()}

                      {movimentacoes.map((mov, i) => {
                        const ehEntrada = mov.tipo_op === 'Entrada'
                        // Movimentações ligadas a caixinhas (categoria
                        // 'caixinha', criadas por caixinha_guardar/resgatar)
                        // e as duas pernas de uma transferência interna
                        // (categoria/transferencia_id) não podem ser
                        // editadas/excluidas direto — operação indivisível.
                        const ehCaixinha = mov.categoria === 'caixinha'
                        const ehTransferencia =
                          mov.categoria === 'transferencia' || !!mov.transferencia_id
                        // Caixinha = só 🔒 (gerencie pelos botões da caixinha).
                        // Transferência = Editar/Excluir próprios (operações
                        // atômicas via RPC; edição parcial nunca existe).
                        const rotuloCategoria = ehTransferencia ? (
                          <span style={estilos.badgeTransferencia}>⇄ transferência</span>
                        ) : mov.categoria ? (
                          <span style={estilosComuns.tipoConta}>{mov.categoria}</span>
                        ) : null

                        // Saldo progressivo: efeito real desta linha na conta,
                        // acumulado desde a abertura (centavos, sem deriva).
                        const saldoLinha = saldosLinha ? saldosLinha.get(mov.id) : null

                        // Reordenação dentro do dia (ETAPA 07 do Extrato):
                        // setinhas ↑/↓ só aparecem quando há vizinho do MESMO
                        // DIA na lista (senão não há o que trocar). A linha
                        // "SALDO FINAL DO PERÍODO" é sintética e fica fora do
                        // .map(), por isso nunca recebe setas.
                        const origemBloqueado = ehCaixinha || ehTransferencia
                        const podeSubir = i > 0 && movimentacoes[i - 1].data === mov.data
                        const podeDescer =
                          i < movimentacoes.length - 1 &&
                          movimentacoes[i + 1].data === mov.data
                        // Mesmo botões de ação (seta ↑/↓ do mesmo tamanho e
                        // paleta de editar/excluir). Caixinha/transferência
                        // continuam com 🔒 (não se reordena operação indivisível).
                        const botoesReordenar = origemBloqueado ? null : (
                          <>
                            {podeSubir && (
                              <button
                                type="button"
                                onClick={() => handleMoverDia(mov, 'subir')}
                                style={estilos.botaoAcao}
                                title="Mover mais para cima (dentro deste dia)"
                                aria-label="Mover movimentação para cima"
                              >
                                ↑
                              </button>
                            )}
                            {podeDescer && (
                              <button
                                type="button"
                                onClick={() => handleMoverDia(mov, 'descer')}
                                style={estilos.botaoAcao}
                                title="Mover mais para baixo (dentro deste dia)"
                                aria-label="Mover movimentação para baixo"
                              >
                                ↓
                              </button>
                            )}
                          </>
                        )

                        const acoes = ehCaixinha ? (
                          <span
                            style={estilos.cadeado}
                            title="Movimentação de caixinha — gerencie pelos botões da caixinha"
                          >
                            🔒
                          </span>
                        ) : ehTransferencia ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleEditarTransferencia(mov)}
                              style={estilos.botaoAcao}
                              title="Editar transferência (remove e reabre o formulário preenchido)"
                              aria-label="Editar transferência"
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              onClick={() => handleExcluirTransferencia(mov)}
                              style={estilos.botaoAcao}
                              title="Excluir transferência (reverte os saldos)"
                              aria-label="Excluir transferência"
                            >
                              🗑️
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => iniciarEdicao(mov)}
                              style={estilos.botaoAcao}
                              title="Editar movimentação"
                              aria-label="Editar movimentação"
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              onClick={() => handleExcluir(mov)}
                              style={estilos.botaoAcao}
                              title="Excluir movimentação"
                              aria-label="Excluir movimentação"
                            >
                              🗑️
                            </button>
                          </>
                        )

                        // Na tabela, transferência recebida ocupa CRÉDITO e a
                        // enviada ocupa DÉBITO (ambas alteram o saldo da conta);
                        // o badge ⇄ mantém a identificação discreta.
                        return esMovil ? (
                          <li key={mov.id} style={estilos.cardMovil}>
                            <div style={estilos.cardMovilTopo}>
                              <div style={estilos.cardMovilDesc}>
                                <span style={estilosComuns.nomeConta}>{mov.descricao}</span>
                                {rotuloCategoria}
                              </div>
                              <span style={estilos.cardMovilData}>
                                {formatarData(mov.data)}
                              </span>
                            </div>
                            <div style={estilos.cardMovilValor}>
                              <span style={estilos.cardMovilRotulo}>
                                {ehEntrada ? 'Crédito' : 'Débito'}
                              </span>
                              <strong
                                style={{
                                  color: ehEntrada ? '#4ade80' : '#f87171',
                                  fontWeight: 'bold',
                                }}
                              >
                                {ehEntrada ? '+' : '−'}{formatoReal.format(Number(mov.valor))}
                              </strong>
                            </div>
                            <div style={estilos.cardMovilValor}>
                              <span style={estilos.cardMovilRotulo}>Saldo</span>
                              <strong style={{ ...corDoSaldo(saldoLinha), fontWeight: 'bold' }}>
                                {saldoLinha === null ? '—' : formatoReal.format(saldoLinha)}
                              </strong>
                            </div>
                            <div style={estilos.cardMovilAcciones}>{botoesReordenar}{acoes}</div>
                          </li>
                        ) : (
                          <li key={mov.id} style={estilos.tabelaLinha}>
                            <span style={estilos.celulaData}>
                              {formatarData(mov.data)}
                            </span>
                            <span style={estilos.celulaDescricao}>
                              <span style={estilosComuns.nomeConta}>{mov.descricao}</span>
                              {rotuloCategoria}
                            </span>
                            <span
                              style={
                                ehEntrada
                                  ? { ...estilos.celulaValor, color: '#4ade80' }
                                  : { ...estilos.celulaValor, color: '#f87171' }
                              }
                            >
                              {ehEntrada ? '+' : '−'}{formatoReal.format(Number(mov.valor))}
                            </span>
                            <span style={{ ...estilos.celulaSaldo, ...corDoSaldo(saldoLinha) }}>
                              {saldoLinha === null ? '—' : formatoReal.format(saldoLinha)}
                            </span>
                            <span style={estilos.celulaAcoes}>{botoesReordenar}{acoes}</span>
                          </li>
                        )
                      })}

                      {/* Linha do pé: SALDO DE ABERTURA (discreta, tracejada)
                          — fica junto à linha mais antiga, como em extratos
                          bancários "mais recente primeiro". Data = início do
                          período ou a data da linha de borda da janela. */}
                      {(() => {
                        if (aberturaEfetiva === null) return null
                        const dataAbertura =
                          filtros.dataInicio && filtros.dataInicio !== '9999-12-31'
                            ? filtros.dataInicio
                            : movimentacoes[movimentacoes.length - 1]?.data ?? ''
                        return esMovil ? (
                          <li key="abertura" style={{ ...estilos.cardMovil, ...estilos.cardAbertura }}>
                            <div style={estilos.cardMovilTopo}>
                              <span style={estilos.rotuloEspecial}>SALDO DE ABERTURA</span>
                              <span style={estilos.cardMovilData}>{formatarData(dataAbertura)}</span>
                            </div>
                            <div style={estilos.cardMovilValor}>
                              <span style={estilos.cardMovilRotulo}>Saldo</span>
                              <strong style={{ ...corDoSaldo(aberturaEfetiva), fontWeight: 'bold' }}>
                                {formatoReal.format(aberturaEfetiva)}
                              </strong>
                            </div>
                          </li>
                        ) : (
                          <li key="abertura" style={{ ...estilos.tabelaLinha, ...estilos.linhaAbertura }}>
                            <span style={estilos.celulaData}>{formatarData(dataAbertura)}</span>
                            <span style={estilos.celulaDescricao}>
                              <span style={estilos.rotuloEspecial}>SALDO DE ABERTURA</span>
                            </span>
                            <span style={estilos.celulaValor} />
                            <span style={{ ...estilos.celulaSaldo, ...corDoSaldo(aberturaEfetiva) }}>
                              {formatoReal.format(aberturaEfetiva)}
                            </span>
                            <span style={estilos.celulaAcoes} />
                          </li>
                        )
                      })()}
                    </ul>
                  </>
                )}
              </>
            )}
          </section>
        </>
      )}

      {/* Formulário: nova movimentação OU edição (mesmo formulário,
        pré-preenchido via iniciarEdicao). Aberto pelo FAB; lança na conta
        ativa. Em modal centralizado (padrão aprovado). */}
      {mostrandoNova && contaAtiva && (
        <ModalFormulario
          titulo={movEmEdicao ? 'Editar movimentação' : 'Nova movimentação'}
          aoFechar={() => {
            setMostrandoNova(false)
            setMovEmEdicao(null)
            setMensagem(null)
          }}
        >
          <form onSubmit={handleSalvarMovimentacao} style={{ ...estilosComuns.form, maxWidth: '100%' }}>
            <p style={estilosComuns.mensagem}>
              Conta: <strong>{contaAtiva.nome}</strong> —{' '}
              {formatoReal.format(Number(contaAtiva.saldo_atual))}
            </p>
            <div style={esMovil ? { ...estilos.gradeLancamento, gridTemplateColumns: '1fr' } : estilos.gradeLancamento}>
              <select
                value={tipoOp}
                onChange={(e) => setTipoOp(e.target.value)}
                style={{ ...estilosComuns.input, background: '#111827' }}
              >
                <option value="Entrada">Entrada</option>
                <option value="Saida">Saída</option>
              </select>
              <input
                type="date" required
                value={data}
                onChange={(e) => setData(e.target.value)}
                style={estilosComuns.input}
              />
              <input
                type="number" step="0.01" min="0.01" required
                placeholder="Valor (R$)"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                style={estilosComuns.input}
              />
              <input
                type="text" required
                placeholder="Descrição"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                style={{ ...estilosComuns.input, gridColumn: 'span 2' }}
              />
              <input
                type="text" placeholder="Categoria"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                style={estilosComuns.input}
              />
            </div>
            <button type="submit" disabled={enviando} style={estilosComuns.botaoCriar}>
              {enviando
                ? 'Salvando...'
                : movEmEdicao
                  ? 'Salvar alterações'
                  : 'Lançar'}
            </button>
          </form>

          {mensagem && (
            <p style={mensagem.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>
              {mensagem.texto}
            </p>
          )}
        </ModalFormulario>
      )}

      {contaAtiva &&
        createPortal(
          <button
            type="button"
            onClick={() => {
              if (mostrandoNova) {
                // Fechar: sai da edição e limpa o formulário.
                setMostrandoNova(false)
                setMovEmEdicao(null)
                setMensagem(null)
              } else {
                abrirFormularioNova()
              }
            }}
            style={esMovil ? { ...estilos.botaoNova, ...estilos.botaoNovaMovel } : estilos.botaoNova}
            aria-expanded={mostrandoNova}
          >
            {mostrandoNova ? '−' : '+'} Nova movimentação
          </button>,
          document.body,
        )}
    </div>
  )
}

// Cor da coluna Saldo: azul do sistema em valores >= 0; negativo usa o
// padrão de alerta âmbar já existente no app (mesma cor do aviso de
// futuros). Sem criar paleta nova.
function corDoSaldo(valor) {
  return { color: valor !== null && valor < 0 ? '#fbbf24' : '#42A5F5' }
}

const estilos = {
  // Lista do extrato: herda o padrão estilosComuns.lista mas SEM o teto de
  // 30vh — a página inteira rola, então os lançamentos nunca ficam cortados.
  // Margem inferior garante folga até o fim da página.
  listaExtrato: {
    ...estilosComuns.lista,
    maxHeight: 'none',
    overflowY: 'visible',
    paddingBottom: '2rem',
  },
  topo: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    marginBottom: '0.75rem',
  },
  badge: {
    fontSize: '0.7rem',
    fontWeight: 'bold',
    color: '#0b0f19',
    background: '#42A5F5',
    borderRadius: '999px',
    padding: '0.15rem 0.55rem',
  },
  // Linha dos filtros: pílulas de período + SALDO ATUAL à direita.
  filtroLinha: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.4rem 1rem',
  },
  filtroPilulas: { flex: '1 1 auto', minWidth: 0 },
  saldoNaLinha: {
    marginLeft: 'auto',
    whiteSpace: 'nowrap',
    fontSize: '0.72rem',
    color: '#9ca3af',
    letterSpacing: '0.03em',
  },
  saldoNaLinhaValor: { color: '#e5e7eb', fontSize: '0.92rem', marginLeft: '0.15rem' },
  // Barra discreta acima da tabela (só o aviso de futuros, quando existe).
  barraResumo: {
    marginBottom: '0.6rem',
    fontSize: '0.72rem',
  },
  avisoFuturoInline: { color: '#fbbf24' },
  // Extrato bancário: Data | Histórico | Débito | Crédito | Saldo (+ Ações),
  // com colunas separadas por linha vertical e valores à direita. A última
  // coluna (Ações) é larga o bastante para até 4 ícones (↑↓ reordenar + ✏️/🗑️).
  tabelaCabecalho: {
    display: 'grid',
    gridTemplateColumns: '84px minmax(0, 1fr) 96px 108px 170px',
    alignItems: 'center',
    padding: '0.3rem 0',
    color: '#6b7280',
    fontSize: '0.68rem',
    fontWeight: 'bold',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    borderBottom: '1px solid #1f2937',
    marginBottom: '0.5rem',
  },
  gradeCabecalho: {
    padding: '0 0.5rem',
    textAlign: 'center',
  },
  tabelaLinha: {
    display: 'grid',
    gridTemplateColumns: '84px minmax(0, 1fr) 96px 108px 170px',
    alignItems: 'center',
    padding: '0.45rem 0',
    borderRadius: '8px',
    background: '#111827',
    border: '1px solid #1f2937',
  },
  celulaData: {
    color: '#9ca3af',
    fontSize: '0.78rem',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    textAlign: 'center',
    padding: '0 0.5rem',
  },
  celulaDescricao: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    textAlign: 'left',
    padding: '0 0.5rem',
    borderLeft: '1px solid #1f2937',
  },
  celulaValor: {
    fontWeight: 'bold',
    fontSize: '0.78rem',
    textAlign: 'right',
    whiteSpace: 'nowrap',
    padding: '0 0.6rem',
    borderLeft: '1px solid #1f2937',
  },
  // Coluna Saldo: azul do sistema; negativo cai no âmbar de alerta
  // (via corDoSaldo). Alinhada à direita como os demais valores.
  celulaSaldo: {
    fontWeight: 'bold',
    fontSize: '0.78rem',
    textAlign: 'right',
    whiteSpace: 'nowrap',
    padding: '0 0.6rem',
    borderLeft: '1px solid #1f2937',
  },
  celulaAcoes: {
    display: 'flex',
    gap: '0.25rem',
    justifyContent: 'center',
    padding: '0 0.25rem',
    borderLeft: '1px solid #1f2937',
  },
  // Rótulo das linhas especiais (abertura/final), em maiúsculas discretas.
  rotuloEspecial: {
    color: '#9ca3af',
    fontWeight: 'bold',
    fontSize: '0.7rem',
    letterSpacing: '0.05em',
  },
  linhaAbertura: { border: '1px dashed #374151' },
  cardAbertura: { border: '1px dashed #374151' },
  linhaFinal: { border: '1px solid #42A5F5' },
  cardFinal: { border: '1px solid #42A5F5' },
  // Botões de ação viraram ícones (✏️ editar, 🗑️ excluir): compactos,
  // com tooltip e aria-label; o valor em strong herda a cor do ícone.
  botaoAcao: {
    background: 'transparent',
    border: '1px solid #374151',
    borderRadius: '6px',
    color: '#9ca3af',
    fontFamily: 'inherit',
    fontSize: '0.78rem',
    lineHeight: 1,
    padding: '0.22rem 0.38rem',
    cursor: 'pointer',
  },
  cadeado: {
    fontSize: '0.7rem',
    cursor: 'default',
    opacity: 0.6,
  },
  // Selo visual das duas pernas de uma transferência interna (substitui o
  // texto da categoria no extrato, desktop e mobile).
  badgeTransferencia: {
    marginLeft: '0.6rem',
    fontSize: '0.65rem',
    fontWeight: 'bold',
    color: '#42A5F5',
    border: '1px solid #374151',
    borderRadius: '999px',
    padding: '0.05rem 0.45rem',
    whiteSpace: 'nowrap',
  },
  // Linha 1: Tipo | Data | Valor — lado a lado. Linha 2: Descrição (2
  // colunas) + Categoria. Formulário compacto para o botão nunca ficar
  // fora da tela.
  gradeLancamento: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '0.6rem',
  },
  // Estratégia móvil para o extrato: fila em tarjeta empilhada (evita
  // o overflow horizontal das colunas fixas da tabela). Conserva Data,
  // Descripción/categoria, el importe (Crédito/Débito) e as acciones.
  cardMovil: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem',
    padding: '0.6rem 0.8rem',
    borderRadius: '10px',
    background: '#111827',
    border: '1px solid #1f2937',
  },
  cardMovilTopo: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
  },
  cardMovilDesc: {
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
  },
  cardMovilData: {
    flexShrink: 0,
    color: '#9ca3af',
    fontSize: '0.72rem',
    whiteSpace: 'nowrap',
  },
  cardMovilValor: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
  },
  cardMovilRotulo: { color: '#9ca3af', fontSize: '0.72rem' },
  cardMovilAcciones: {
    display: 'flex',
    gap: '0.4rem',
    justifyContent: 'flex-end',
  },
  botaoNova: {
    position: 'fixed',
    right: '1rem',
    bottom: '1rem',
    padding: '0.7rem 1.1rem',
    borderRadius: '999px',
    border: 'none',
    background: '#42A5F5',
    color: '#0b0f19',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'inherit',
    // Acima do header fixo (z-30) e da bottom nav (z-20).
    zIndex: 40,
  },
  botaoNovaMovel: {
    // Sobe acima da bottom nav (altura ~3.6rem) + home indicator.
    bottom: 'calc(4.4rem + env(safe-area-inset-bottom, 0px))',
  },
}