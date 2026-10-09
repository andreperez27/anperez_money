import { useEffect, useMemo, useState } from 'react'
import { usePonto, useBancoHoras } from '../hooks/usePonto'
import { estilosComuns, formatoReal, formatarData, hoje } from '../lib/compartilhados'
import ModalFormulario from '../components/ModalFormulario'
import SeletorPeriodo from '../components/planejamento/SeletorPeriodo'
import { definirPeriodo, deslocarPeriodo, ehPeriodoAtual } from '../lib/periodos'
import {
  calcularLancamento,
  classificarDia,
  classificarTurnoParaUI,
  qtdDiasIntervalo,
  QUOTA_FERIAS_ANUAL,
  previstoAReceberDaSemana,
  calcularFalta,
  datasFaltaPeriodo,
  faltanteDoTurno,
  formatarDuracaoHMin,
} from '../lib/pontoCalc'

// Página Ponto Inteligente (ETAPA 07/08).
//
// Modelo por EXCEÇÕES: a carga padrão (seg–sex 20:30→03:00, sáb 20:30→02:00,
// domingo off) é constante da aplicação e NUNCA é lançada. Aqui o usuário
// lança o que FUGIU do padrão:
//   • "Lançar avulso" abre o modal padrão do app com entrada/saída — o SISTEMA
//     analisa a data e classifica sozinho: hora extra (dia útil com carga a
//     mais), domingo/feriado (diária dom/fer), compensação (carga igual ao
//     padrão com horário atípico, registrado por controle) ou o dia padrão
//     (que dispensa lançamento);
//   • "Marcar férias" abre o mesmo modal com intervalo (início/fim; dia único
//     = início igual a fim) e controle do saldo de 15 dias do ano.
// O resumo da semana soma as exceções + dias de férias; os demais dias contam
// como padrão. Os feriados são geridos na página Configurações (PontoConfig).
export default function Ponto() {
  // Linha do tempo SEMANAL (mesmo padrão de Planejamento, via periodos.js +
  // SeletorPeriodo): a semana que contém hoje, navegável com ‹ › Hoje.
  const [periodo, setPeriodo] = useState(() => definirPeriodo('semana', hoje()))
  const janela = useMemo(
    () => ({ inicioISO: periodo.inicio, fimISO: periodo.fim }),
    [periodo],
  )
  const unidadeAtual = useMemo(
    () => ehPeriodoAtual('semana', periodo, hoje()),
    [periodo],
  )

  const {
    carregando,
    erro,
    excecoes,
    feriados,
    ferias,
    config,
    resumo,
    cargaEsperada,
    carregarPeriodo,
    criarExcecaoTrabalho,
    criarFalta,
    criarFerias,
    excluirFerias,
    saldoFerias,
    excluirExcecao,
    editarExcecao,
  } = usePonto(janela)

  // Banco de horas: visão all-time (fora da janela semanal), com os tempos
  // da carga vindos da config do próprio hook.
  const banco = useBancoHoras(config.temposCarga)

  // Modal centralizado (padrão das demais páginas):
  // 'trabalho' | 'ferias' | 'falta' | null.
  const [modal, setModal] = useState(null)
  const [data, setData] = useState('')
  const [dataFeriasFim, setDataFeriasFim] = useState('')
  const [entrada, setEntrada] = useState('20:30')
  const [saida, setSaida] = useState('03:00')
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [mensagem, setMensagem] = useState(null)
  const [editando, setEditando] = useState(null)
  // Destino da HE (pagamento = padrão) + campos do modal de falta.
  const [destinoHe, setDestinoHe] = useState('pagamento')
  const [dataFaltaFim, setDataFaltaFim] = useState('')
  const [faltaDestino, setFaltaDestino] = useState('pagamento')
  // Oferta de falta parcial no avulso (saída antecipada): unchecked = manual.
  const [lancarFaltaParcial, setLancarFaltaParcial] = useState(false)

  // Prévia da classificação/duração enquanto o usuário digita (mesmo cálculo
  // que o hook fará ao salvar — o tipo é decidido PELA DATA, não pelo usuário).
  const previsao = useMemo(() => {
    if (modal !== 'trabalho' || !data || !entrada || !saida) return null
    try {
      const r = calcularLancamento(data, { entrada, saida }, { feriados, config })
      const rotulo = classificarTurnoParaUI(data, { entrada, saida }, { feriados })
      const rotulos = {
        domfer: 'Domingo/Feriado',
        he: 'Hora extra',
        compensacao: 'Compensação (carga igual ao padrão)',
        padrao: 'Horário padrão — dispensa lançamento',
      }
      return {
        tipo: rotulos[rotulo] ?? rotulo,
        ehPadrao: rotulo === 'padrao',
        ehCompensacao: rotulo === 'compensacao',
        horas: r.horas,
        he: r.he,
        valor: r.tipo === 'domfer' ? r.valorDomfer : r.valorHe,
      }
    } catch {
      return null
    }
  }, [modal, data, entrada, saida, feriados, config])

  // "Previsto a receber" da semana visível: fixo (já descontado por feriados
  // E faltas com destino pagamento) + HE + diárias dom/fer. Mesmo cálculo da
  // reconciliação do Planejamento.
  const previstoDaSemana = useMemo(
    () =>
      previstoAReceberDaSemana({
        fixoSemana: config.fixoSemana ?? 0,
        resumo,
        feriados,
        inicioISO: janela.inicioISO,
        fimISO: janela.fimISO,
        faltas: excecoes,
      }),
    [config.fixoSemana, resumo, feriados, excecoes, janela.inicioISO, janela.fimISO],
  )

  // HE separada por destino para o card do Resumo (risco 4 aprovado): pagas
  // (com valor a receber) vs no banco (só horas, valor zerado no Previsto).
  const heBancoHoras = useMemo(
    () =>
      Math.round(
        (excecoes ?? [])
          .filter((ex) => ex && ex.tipo === 'he' && (ex.destino ?? 'pagamento') === 'banco')
          .reduce((acc, ex) => acc + Number(ex.he || 0), 0) * 100,
      ) / 100,
    [excecoes],
  )
  const hePagasHoras = Math.round((resumo.he - heBancoHoras) * 100) / 100

  // Dom/fer separado por destino (mesmo padrão da HE do banco): dias pagos
  // (com diárias) vs dias no banco (só horas trabalhadas, valor zerado).
  const domferBanco = useMemo(() => {
    let qtd = 0
    let horas = 0
    for (const ex of excecoes ?? []) {
      if (ex && ex.tipo === 'domfer' && (ex.destino ?? 'pagamento') === 'banco') {
        qtd += Number(ex.domfer_qtd ?? 0)
        horas = Math.round((horas + Number(ex.horas || 0)) * 100) / 100
      }
    }
    return { qtd, horas }
  }, [excecoes])

  // Minutos faltantes do turno digitado (só criação, nunca edição): base
  // menos trabalhados quando 0 < trabalhados < base em dia útil.
  const faltante = useMemo(() => {
    if (modal !== 'trabalho' || editando || !data || !entrada || !saida) return null
    try {
      return faltanteDoTurno(data, { entrada, saida }, { feriados })
    } catch {
      return null
    }
  }, [modal, editando, data, entrada, saida, feriados])

  // Prévia da falta enquanto preenche (sempre integral aqui; parcial vai
  // pelo avulso): dias úteis + minutos/desconto do 1º dia.
  const previaFalta = useMemo(() => {
    if (modal !== 'falta' || editando || !data) return null
    try {
      const { datas } = datasFaltaPeriodo(data, dataFaltaFim || data, { feriados, ferias })
      if (datas.length === 0) return { dias: 0 }
      const primeira = calcularFalta(datas[0], {
        integral: true,
        destino: faltaDestino,
        fixoSemana: config.fixoSemana ?? 0,
        tempos: config.temposCarga,
        feriados,
        ferias,
      })
      return { dias: datas.length, minutos: primeira.minutos, desconto: primeira.valor_desconto }
    } catch {
      return null
    }
  }, [modal, editando, data, dataFaltaFim, faltaDestino, config, feriados, ferias])

  // Quando o período visível muda (setas da semana), o hook recarrega sozinho.
  useEffect(() => {
    carregarPeriodo(janela.inicioISO, janela.fimISO)
  }, [janela]) // eslint-disable-line react-hooks/exhaustive-deps

  function abrirModal(tipo) {
    setMensagem(null)
    setData('')
    setDataFeriasFim('')
    setEntrada('20:30')
    setSaida('03:00')
    setObs('')
    setDestinoHe('pagamento')
    setDataFaltaFim('')
    setFaltaDestino('pagamento')
    setLancarFaltaParcial(false)
    setEditando(null)
    setModal(tipo)
  }

  function abrirEdicao(ex) {
    setMensagem(null)
    setData(ex.data)
    setEntrada(ex.entrada ?? '20:30')
    setSaida(ex.saida ?? '03:00')
    setObs(ex.obs ?? '')
    setDestinoHe(ex.destino ?? 'pagamento')
    setFaltaDestino(ex.destino ?? 'pagamento')
    setDataFaltaFim('')
    setEditando(ex)
    setModal(ex.tipo === 'falta' ? 'falta' : 'trabalho')
  }

  function aoDeslocar(delta) {
    setPeriodo((p) => deslocarPeriodo('semana', p, delta))
  }

  function aoIrParaHoje() {
    setPeriodo(definirPeriodo('semana', hoje()))
  }

  function fecharModal() {
    setModal(null)
    setMensagem(null)
    setEditando(null)
  }

  async function handleSubmeter(e) {
    e.preventDefault()
    if (!data) {
      setMensagem({ tipo: 'erro', texto: 'Selecione a data.' })
      return
    }
    if (modal === 'trabalho' && !previsao) {
      setMensagem({ tipo: 'erro', texto: 'Informe a data, a entrada e a saída para o sistema analisar o dia.' })
      return
    }
    if (modal === 'trabalho' && previsao.ehPadrao) {
      setMensagem({
        tipo: 'erro',
        texto: 'Este é o horário padrão — o dia já conta como carga cumprida e dispensa lançamento.',
      })
      return
    }
    setEnviando(true)
    setMensagem(null)
    try {
      if (modal === 'ferias') {
        const fim = dataFeriasFim || data
        const dias = qtdDiasIntervalo({ data_inicio: data, data_fim: fim })
        await criarFerias({ inicioISO: data, fimISO: fim, obs: obs || undefined })
        setMensagem({
          tipo: 'ok',
          texto: `Férias de ${formatarData(data)} a ${formatarData(fim)} marcadas (${dias} dia(s)).`,
        })
      } else if (modal === 'trabalho' && lancarFaltaParcial && faltante && !editando) {
        const motivoBase = obs && obs.trim() !== '' ? `${obs.trim()} ` : ''
        const dias = await criarFalta({
          inicioISO: data,
          integral: false,
          minutos: faltante.minutos,
          destino: faltaDestino,
          motivo: `${motivoBase}(${entrada}→${saida})` || undefined,
        })
        setMensagem({
          tipo: 'ok',
          texto: `Falta parcial de ${formatarDuracaoHMin(faltante.minutos)} registrada em ${dias.map(formatarData).join(', ')}.`,
        })
        setLancarFaltaParcial(false)
      } else if (modal === 'falta' && editando) {
        await editarExcecao(editando.id, { destino: faltaDestino, obs: obs || undefined })
        setMensagem({
          tipo: 'ok',
          texto: `Falta de ${formatarData(data)} atualizada.`,
        })
        setEditando(null)
      } else if (modal === 'falta') {
        // Parcial saiu deste modal (vai pelo avulso): aqui é sempre integral.
        const dias = await criarFalta({
          inicioISO: data,
          fimISO: dataFaltaFim || data,
          integral: true,
          destino: faltaDestino,
          motivo: obs || undefined,
        })
        setMensagem({
          tipo: 'ok',
          texto: `Falta registrada em ${dias.length} dia(s): ${dias.map(formatarData).join(', ')}.`,
        })
      } else if (editando) {
        await editarExcecao(editando.id, { dataISO: data, entrada, saida, destino: destinoHe, obs: obs || undefined })
        setMensagem({
          tipo: 'ok',
          texto: `Lançamento de ${formatarData(data)} atualizado — ${previsao.tipo}.`,
        })
        setEditando(null)
      } else {
        await criarExcecaoTrabalho({ dataISO: data, entrada, saida, destino: destinoHe, obs: obs || undefined })
        setMensagem({
          tipo: 'ok',
          texto: `Lançado em ${formatarData(data)} — ${previsao.tipo}.`,
        })
      }
      setData('')
      setDataFeriasFim('')
      setObs('')
      // O banco é all-time (fora da janela): recarrega separado.
      await banco.recarregar().catch(() => {})
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: `Não foi possível lançar: ${err.message}` })
    } finally {
      setEnviando(false)
    }
  }

  async function handleExcluirExcecao(id) {
    try {
      await excluirExcecao(id)
      await banco.recarregar().catch(() => {})
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: `Erro ao excluir: ${err.message}` })
    }
  }

  return (
    <div style={estilosComuns.conteudo}>
      <header style={{ marginBottom: '1.25rem' }}>
        <h2 style={estilosCabecalho.titulo}>Ponto Inteligente</h2>
      </header>

      <SeletorPeriodo
        tipo="semana"
        tipos={['semana']}
        periodo={periodo}
        unidadeAtual={unidadeAtual}
        desabilitado={carregando}
        aoTrocarTipo={() => {}}
        aoDeslocar={aoDeslocar}
        aoIrParaHoje={aoIrParaHoje}
      />

      {erro && (
        <p style={estilosComuns.erro}>
          Não foi possível carregar o módulo: {erro}
        </p>
      )}

      {!erro && (
        <>
          {/* ── Resumo do mês ─────────────────────────────────────────── */}
          <section style={estilosComuns.secao}>
            <h3>Resumo da semana</h3>
            {carregando ? (
              <p style={estilosComuns.mensagem}>Carregando...</p>
            ) : (
              <>
                <ul style={estilosResumo.grade}>
                  <li style={estilosResumo.card}>
                    <span style={estilosResumo.rotulo}>Carga horária</span>
                    <span style={estilosResumo.valor}>
                      {cargaEsperada + resumo.he + resumo.horasDomfer}h
                    </span>
                    <span style={estilosResumo.meta}>
                      esperada {cargaEsperada}h + HE + dom/fer
                    </span>
                  </li>
                  <li style={estilosResumo.card}>
                    <span style={estilosResumo.rotulo}>Hora extra</span>
                    <span style={estilosResumo.valor}>{resumo.he}h</span>
                    <span style={estilosResumo.meta}>
                      {hePagasHoras}h pagas · {formatoReal.format(resumo.valorHe)} a receber
                      {heBancoHoras > 0 && ` · ${heBancoHoras}h no banco`}
                    </span>
                  </li>
                  <li style={estilosResumo.card}>
                    <span style={estilosResumo.rotulo}>Domingos/feriados</span>
                    <span style={estilosResumo.valor}>{resumo.domferQtd} dia(s)</span>
                    <span style={estilosResumo.meta}>
                      {formatoReal.format(resumo.valorDomfer)} em diárias
                      {domferBanco.qtd > 0 && ` · ${domferBanco.qtd} dia(s) no banco`}
                    </span>
                  </li>
                  <li style={estilosResumo.card}>
                    <span style={estilosResumo.rotulo}>Previsto a receber</span>
                    <span style={estilosResumo.valor}>
                      {formatoReal.format(previstoDaSemana.valor)}
                    </span>
                    <span style={estilosResumo.meta}>
                      fixo{' '}
                      {formatoReal.format(
                        (config.fixoSemana ?? 0) - previstoDaSemana.desconto - (previstoDaSemana.descontoFaltas ?? 0),
                      )}
                      {previstoDaSemana.desconto > 0 && (
                        <span style={{ color: '#7c3aed' }}>
                          {' '}
                          (−{formatoReal.format(previstoDaSemana.desconto)} feriado)
                        </span>
                      )}
                      {(previstoDaSemana.descontoFaltas ?? 0) > 0 && (
                        <span style={{ color: '#f59e0b' }}>
                          {' '}
                          (−{formatoReal.format(previstoDaSemana.descontoFaltas)} faltas)
                        </span>
                      )}{' '}
                      + HE + diárias
                    </span>
                  </li>
                </ul>
                <p style={estilosComuns.mensagem}>
                  Dia sem lançamento conta como carga padrão cumprida. Saldo do período:{' '}
                  <strong style={estilosResumo.saldo}>
                    {resumo.he + resumo.horasDomfer >= 0 ? '+' : ''}
                    {Math.round((resumo.he + resumo.horasDomfer) * 100) / 100}h
                  </strong>
                </p>
              </>
            )}
          </section>

          {/* ── Banco de horas (all-time, sem janela) ─────────────────────── */}
          <section style={estilosComuns.secao}>
            <h3>Banco de horas</h3>
            {banco.carregando ? (
              <p style={estilosComuns.mensagem}>Carregando...</p>
            ) : banco.erro ? (
              <p style={estilosComuns.erro}>Não foi possível carregar o banco: {banco.erro}</p>
            ) : (
              <>
                <ul style={estilosResumo.grade}>
                  <li style={estilosResumo.card}>
                    <span style={estilosResumo.rotulo}>Saldo</span>
                    <span
                      style={{
                        ...estilosResumo.valor,
                        color: banco.saldoMin > 0 ? '#4ade80' : banco.saldoMin < 0 ? '#f87171' : '#9ca3af',
                      }}
                    >
                      {formatarDuracaoHMin(banco.saldoMin)}
                    </span>
                    <span style={estilosResumo.meta}>
                      {banco.saldoMin > 0 ? 'em dia' : banco.saldoMin < 0 ? 'horas a compensar' : 'zerado'}
                    </span>
                  </li>
                  <li style={estilosResumo.card}>
                    <span style={estilosResumo.rotulo}>Direito a folga</span>
                    <span style={estilosResumo.valor}>
                      {banco.folgaDias > 0 ? `${banco.folgaDias} dia(s)` : '—'}
                    </span>
                    <span style={estilosResumo.meta}>saldo acima de zero</span>
                  </li>
                  <li style={estilosResumo.card}>
                    <span style={estilosResumo.rotulo}>Créditos (HE no banco)</span>
                    <span style={estilosResumo.valor}>+{formatarDuracaoHMin(banco.creditosMin)}</span>
                    <span style={estilosResumo.meta}>horas extras guardadas</span>
                  </li>
                  <li style={estilosResumo.card}>
                    <span style={estilosResumo.rotulo}>Débitos (faltas no banco)</span>
                    <span style={estilosResumo.valor}>−{formatarDuracaoHMin(banco.debitosMin)}</span>
                    <span style={estilosResumo.meta}>faltas descontadas do banco</span>
                  </li>
                </ul>
                <h4 style={estilosBanco.subtitulo}>Lançamentos do banco</h4>
                {banco.lancamentos.filter(
                  (l) => ((l.tipo === 'he' || l.tipo === 'domfer') && l.destino === 'banco') || (l.tipo === 'falta' && l.destino === 'banco'),
                ).length === 0 ? (
                  <p style={estilosComuns.mensagem}>Nenhum lançamento no banco de horas.</p>
                ) : (
                  <ul style={estilosComuns.lista}>
                    {banco.lancamentos
                      .filter(
                        (l) => ((l.tipo === 'he' || l.tipo === 'domfer') && l.destino === 'banco') || (l.tipo === 'falta' && l.destino === 'banco'),
                      )
                      .map((l) => (
                        <li key={l.id} style={estilosComuns.item}>
                          <div>
                            <span style={estilosComuns.nomeConta}>{formatarData(l.data)}</span>
                            <span style={estilosComuns.tipoConta}>
                              {l.tipo === 'he' ? 'HE no banco' : l.tipo === 'domfer' ? 'Dom/fer no banco' : 'Falta no banco'}
                              {l.obs ? ` · ${l.obs}` : ''}
                            </span>
                          </div>
                          <span style={estilosComuns.saldo}>
                            {l.tipo === 'falta'
                              ? `−${formatarDuracaoHMin(Number(l.minutos_falta) || 0)}`
                              : `+${formatarDuracaoHMin(l.tipo === 'he' ? Math.round(Number(l.he || 0) * 60) : Math.round(Number(l.horas || 0) * 60))}`}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
                <h4 style={estilosBanco.subtitulo}>Status das faltas</h4>
                {banco.faltasStatus.length === 0 ? (
                  <p style={estilosComuns.mensagem}>Nenhuma falta com destino banco.</p>
                ) : (
                  <ul style={estilosComuns.lista}>
                    {banco.faltasStatus.map((f) => (
                      <li key={f.data} style={estilosComuns.item}>
                        <div>
                          <span style={estilosComuns.nomeConta}>{formatarData(f.data)}</span>
                          <span style={estilosComuns.tipoConta}>
                            {formatarDuracaoHMin(f.minutos)} · acumulado {formatarDuracaoHMin(f.acumulado)}
                          </span>
                        </div>
                        <span
                          style={{
                            ...estilosBanco.badge,
                            ...(f.status === 'compensada' ? estilosBanco.badgeOk : estilosBanco.badgePendente),
                          }}
                        >
                          {f.status === 'compensada' ? 'Compensada' : 'Pendente'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          {/* ── Lançamentos da semana ─────────────────────────────────── */}
          <section style={estilosComuns.secao}>
            <div style={estilosCabecalho.linha}>
              <h3 style={{ margin: 0 }}>Lançamentos da semana</h3>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => abrirModal('trabalho')}
                  style={estilosComuns.botaoCriar}
                >
                  + Lançar avulso
                </button>
                <button
                  type="button"
                  onClick={() => abrirModal('falta')}
                  style={estilosComuns.botaoCriar}
                >
                  + Lançar falta
                </button>
              </div>
            </div>
            {carregando ? (
              <p style={estilosComuns.mensagem}>Carregando...</p>
            ) : excecoes.length === 0 ? (
              <p style={estilosComuns.mensagem}>
                Nenhuma exceção neste período — tudo foi carga padrão cumprida.
              </p>
            ) : (
              <ul style={estilosComuns.lista}>
                {excecoes.map((ex) => (
                  <li key={ex.id} style={estilosComuns.item}>
                    <div>
                      <span style={estilosComuns.nomeConta}>{formatarData(ex.data)}</span>
                      <span style={estilosComuns.tipoConta}>
                        {rotuloTipo(ex.tipo)}
                        {ex.entrada ? ` · ${ex.entrada} → ${ex.saida}` : ''}
                        {ex.tipo === 'falta' ? ` · ${formatarDuracaoHMin(Number(ex.minutos_falta) || 0)}` : ''}
                        {ex.obs ? ` · ${ex.obs}` : ''}
                      </span>
                      {(ex.tipo === 'he' || ex.tipo === 'domfer' || ex.tipo === 'falta') && ex.destino && ex.destino !== 'pagamento' && (
                        <div style={estilosComuns.tipoConta}>
                          {ex.destino === 'banco' ? 'Banco de horas' : 'Abonada'}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {ex.tipo === 'falta' ? (
                        <span style={estilosComuns.saldo}>
                          −{formatarDuracaoHMin(Number(ex.minutos_falta) || 0)}
                        </span>
                      ) : (
                        <span style={estilosComuns.saldo}>
                          {Number(ex.horas)}h{Number(ex.he) > 0 ? ` (+${Number(ex.he)} HE)` : ''}
                        </span>
                      )}
                      {ex.tipo === 'falta' && ex.destino === 'pagamento' && Number(ex.valor_desconto) > 0 && (
                        <div style={estilosComuns.mensagem}>
                          −{formatoReal.format(Number(ex.valor_desconto))}
                        </div>
                      )}
                      {Number(ex.valor_domfer) > 0 && (
                        <div style={estilosComuns.mensagem}>
                          {formatoReal.format(Number(ex.valor_domfer))}
                        </div>
                      )}
                      {Number(ex.valor_he) > 0 && (
                        <div style={estilosComuns.mensagem}>
                          {formatoReal.format(Number(ex.valor_he))}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => abrirEdicao(ex)}
                        style={estilosAcao.editar}
                      >
                        editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExcluirExcecao(ex.id)}
                        style={estilosAcao.excluir}
                      >
                        excluir
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Férias (intervalos) ───────────────────────────────────── */}
          <section style={estilosComuns.secao}>
            <div style={estilosCabecalho.linha}>
              <h3 style={{ margin: 0 }}>Férias (ano {new Date().getFullYear()})</h3>
              <button
                type="button"
                onClick={() => abrirModal('ferias')}
                style={estilosComuns.botaoCriar}
              >
                + Marcar férias
              </button>
            </div>
            {ferias.length === 0 ? (
              <p style={estilosComuns.mensagem}>Nenhuma férias marcadas.</p>
            ) : (
              <ul style={estilosComuns.lista}>
                {ferias.map((f) => (
                  <li key={f.id} style={estilosComuns.item}>
                    <div>
                      <span style={estilosComuns.nomeConta}>
                        {formatarData(f.data_inicio)} → {formatarData(f.data_fim)}
                      </span>
                      <span style={estilosComuns.tipoConta}>
                        {qtdDiasIntervalo(f)} dia(s)
                        {f.obs ? ` · ${f.obs}` : ''}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => excluirFerias(f.id)}
                      style={estilosAcao.excluir}
                    >
                      excluir
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {/* ── Modal padrão do app: avulso, férias OU falta ─────────────── */}
      {modal && (
        <ModalFormulario
          titulo={
            editando
              ? 'Editar lançamento'
              : modal === 'trabalho'
                ? 'Lançamento avulso'
                : modal === 'falta'
                  ? 'Lançar falta'
                  : 'Marcar férias'
          }
          aoFechar={fecharModal}
        >
          <form onSubmit={handleSubmeter} style={{ ...estilosComuns.form, maxWidth: '100%' }}>
            {modal === 'trabalho' ? (
              <>
                <input
                  type="date"
                  value={data}
                  onChange={(e) => setData(e.target.value)}
                  style={estilosComuns.input}
                  required
                />
                <div style={estilosComuns.formGrade}>
                  <input
                    type="time"
                    value={entrada}
                    onChange={(e) => setEntrada(e.target.value)}
                    style={estilosComuns.input}
                    required
                  />
                  <input
                    type="time"
                    value={saida}
                    onChange={(e) => setSaida(e.target.value)}
                    style={estilosComuns.input}
                    required
                  />
                </div>
                {faltante && !editando && (
                  <label style={{ ...estilosDestino.opcao, ...estilosFaltaOferta.caixa }}>
                    <input
                      type="checkbox"
                      checked={lancarFaltaParcial}
                      onChange={(e) => setLancarFaltaParcial(e.target.checked)}
                    />
                    Registrar os {formatarDuracaoHMin(faltante.minutos)} faltantes como falta parcial
                  </label>
                )}
                {lancarFaltaParcial && faltante && !editando ? (
                  <div style={estilosDestino.linha}>
                    <span style={estilosDestino.rotulo}>Destino da falta</span>
                    <div style={estilosDestino.opcoes}>
                      {[
                        ['pagamento', 'Descontar do pagamento'],
                        ['banco', 'Debitar do banco'],
                        ['abonada', 'Abonada'],
                      ].map(([valor, rotulo]) => (
                        <label key={valor} style={estilosDestino.opcao}>
                          <input
                            type="radio"
                            name="falta-destino-avulso"
                            checked={faltaDestino === valor}
                            onChange={() => setFaltaDestino(valor)}
                          />
                          {rotulo}
                        </label>
                      ))}
                    </div>
                    <span style={estilosDestino.saldoInfo}>
                      Saldo do banco: {formatarDuracaoHMin(banco.saldoMin)}
                    </span>
                  </div>
                ) : (
                  <div style={estilosDestino.linha}>
                    <span style={estilosDestino.rotulo}>Destino das horas</span>
                    <div style={estilosDestino.opcoes}>
                      <label style={estilosDestino.opcao} title="Regra antiga: entra no valor a receber da semana">
                        <input
                          type="radio"
                          name="destino-he"
                          checked={destinoHe === 'pagamento'}
                          onChange={() => setDestinoHe('pagamento')}
                        />
                        Horas avulsas
                      </label>
                      <label style={estilosDestino.opcao} title="Vira crédito em horas e minutos no saldo do banco">
                        <input
                          type="radio"
                          name="destino-he"
                          checked={destinoHe === 'banco'}
                          onChange={() => setDestinoHe('banco')}
                        />
                        Banco de horas
                      </label>
                    </div>
                    <span style={estilosDestino.saldoInfo}>
                      Saldo do banco: {formatarDuracaoHMin(banco.saldoMin)}
                    </span>
                  </div>
                )}
              </>
            ) : modal === 'falta' ? (
              <>
                {editando ? (
                  <p style={estilosComuns.mensagem}>
                    {formatarData(data)} · {formatarDuracaoHMin(Number(editando.minutos_falta) || 0)} faltados
                  </p>
                ) : (
                  <>
                    <div style={estilosComuns.formGrade}>
                      <label style={estilosCampoModal.rotulo}>
                        Início
                        <input
                          type="date"
                          value={data}
                          onChange={(e) => setData(e.target.value)}
                          style={estilosComuns.input}
                          required
                        />
                      </label>
                      <label style={estilosCampoModal.rotulo}>
                        Fim (opcional)
                        <input
                          type="date"
                          value={dataFaltaFim}
                          onChange={(e) => setDataFaltaFim(e.target.value)}
                          style={estilosComuns.input}
                          placeholder="Dia único: vazio"
                        />
                      </label>
                    </div>
                    {previaFalta && previaFalta.dias > 0 && (
                      <p style={estilosComuns.mensagem}>
                        {previaFalta.dias} dia(s) útil(eis)
                        {previaFalta.minutos != null && (
                          <> · {formatarDuracaoHMin(previaFalta.minutos)}/dia · desconto {formatoReal.format(previaFalta.desconto)}/dia</>
                        )}
                      </p>
                    )}
                  </>
                )}
                <div style={estilosDestino.linha}>
                  <span style={estilosDestino.rotulo}>Destino da falta</span>
                  <div style={estilosDestino.opcoes}>
                    {[
                      ['pagamento', 'Descontar do pagamento'],
                      ['banco', 'Debitar do banco'],
                      ['abonada', 'Abonada'],
                    ].map(([valor, rotulo]) => (
                      <label key={valor} style={estilosDestino.opcao}>
                        <input
                          type="radio"
                          name="falta-destino"
                          checked={faltaDestino === valor}
                          onChange={() => setFaltaDestino(valor)}
                        />
                        {rotulo}
                      </label>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <input
                  type="date"
                  value={data}
                  onChange={(e) => setData(e.target.value)}
                  style={estilosComuns.input}
                  required
                />
                <input
                  type="date"
                  value={dataFeriasFim}
                  onChange={(e) => setDataFeriasFim(e.target.value)}
                  style={estilosComuns.input}
                  placeholder="Data fim (opcional)"
                />
                <p style={estilosComuns.mensagem}>
                  Início acima · fim ao lado (dia único: deixe o fim em branco) · Saldo de{' '}
                  <strong>{data ? saldoFerias(data) : QUOTA_FERIAS_ANUAL}</strong> de{' '}
                  {QUOTA_FERIAS_ANUAL} dias no ano
                </p>
              </>
            )}
            <input
              type="text"
              placeholder="Observação (opcional)"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              style={estilosComuns.input}
            />
            {modal === 'trabalho' && previsao && destinoHe === 'pagamento' && !lancarFaltaParcial && (
              <p style={estilosComuns.mensagem}>
                O sistema reconheceu: <strong>{previsao.tipo}</strong> · {previsao.horas}h
                trabalhadas{previsao.he > 0 ? ` · ${previsao.he}h de HE` : ''} ·{' '}
                {formatoReal.format(previsao.valor)}
                {previsao.ehPadrao &&
                  ' — o dia já conta como carga cumprida sem lançamento.'}
                {previsao.ehCompensacao &&
                  ' — será registrado por controle (compensação de uma hora faltante).'}
              </p>
            )}
            {modal === 'trabalho' && previsao && destinoHe === 'banco' && !previsao.ehPadrao && !lancarFaltaParcial && (
              <p style={estilosComuns.mensagem}>
                O sistema reconheceu: <strong>{previsao.tipo}</strong> ·{' '}
                {previsao.he > 0
                  ? `${previsao.he}h de HE indo para o banco de horas`
                  : `${previsao.horas}h trabalhadas indo para o banco de horas`}{' '}
                · não gera valor a receber.
              </p>
            )}
            {modal === 'trabalho' && lancarFaltaParcial && faltante && !editando && (
              <p style={estilosComuns.mensagem}>
                Vai registrar falta parcial de <strong>{formatarDuracaoHMin(faltante.minutos)}</strong> (carga
                do dia menos {previsao?.horas ?? '?'}h trabalhadas).
              </p>
            )}
            {modal === 'trabalho' && previsao?.ehPadrao && (
              <p style={estilosComuns.mensagemOk}>
                Nada a lançar neste dia: horário padrão cumprido.
              </p>
            )}
            <button
              type="submit"
              disabled={enviando || (modal === 'trabalho' && previsao?.ehPadrao)}
              style={estilosComuns.botaoCriar}
            >
              {enviando
                ? editando ? 'Atualizando...' : 'Lançando...'
                : modal === 'ferias'
                  ? 'Marcar férias'
                  : modal === 'falta'
                    ? editando ? 'Atualizar falta' : 'Lançar falta'
                    : editando
                      ? 'Atualizar'
                      : lancarFaltaParcial && faltante
                        ? 'Lançar falta parcial'
                        : 'Lançar avulso'}
            </button>
          </form>

          {mensagem && (
            <p style={mensagem.tipo === 'ok' ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>
              {mensagem.texto}
            </p>
          )}
        </ModalFormulario>
      )}
    </div>
  )
}

function rotuloTipo(tipo) {
  if (tipo === 'he') return 'Hora extra'
  if (tipo === 'domfer') return 'Domingo/Feriado'
  if (tipo === 'ferias') return 'Férias'
  if (tipo === 'falta') return 'Falta'
  return tipo
}

// Estilos locais (não poluem estilosComuns, compartilhado pelas páginas).
const estilosCabecalho = {
  titulo: { margin: 0, fontSize: '1.3rem', fontWeight: 'bold', color: '#e5e7eb' },
  linha: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '0.5rem',
    marginBottom: '0.75rem',
  },
}

const estilosResumo = {
  grade: {
    listStyle: 'none',
    padding: 0,
    margin: '0 0 0.75rem',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '0.6rem',
  },
  card: {
    padding: '0.8rem 1rem',
    borderRadius: '10px',
    background: '#111827',
    border: '1px solid #1f2937',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  rotulo: { color: '#9ca3af', fontSize: '0.8rem' },
  valor: { fontWeight: 'bold', fontSize: '1.05rem' },
  meta: { color: '#9ca3af', fontSize: '0.75rem' },
  saldo: { color: '#42A5F5' },
}

const estilosBanco = {
  subtitulo: { margin: '0.9rem 0 0.4rem', fontSize: '0.9rem', color: '#e5e7eb' },
  badge: {
    padding: '0.15rem 0.55rem',
    borderRadius: '999px',
    fontSize: '0.72rem',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
  },
  badgeOk: { background: 'rgba(74, 222, 128, 0.15)', color: '#4ade80' },
  badgePendente: { background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' },
}

const estilosDestino = {
  linha: { display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  rotulo: { color: '#9ca3af', fontSize: '0.8rem' },
  opcoes: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1rem' },
  opcao: { display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#e5e7eb', fontSize: '0.9rem', cursor: 'pointer' },
  saldoInfo: { color: '#6b7280', fontSize: '0.78rem' },
}

const estilosCampoModal = {
  rotulo: { display: 'flex', flexDirection: 'column', gap: '0.25rem', color: '#9ca3af', fontSize: '0.8rem' },
}

const estilosFaltaOferta = {
  caixa: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.4rem',
    color: '#e5e7eb',
    fontSize: '0.9rem',
    cursor: 'pointer',
    background: '#111827',
    border: '1px dashed #374151',
    borderRadius: '8px',
    padding: '0.5rem 0.7rem',
  },
}

const estilosAcao = {
  editar: {
    marginTop: '0.3rem',
    background: 'none',
    border: 'none',
    color: '#42A5F5',
    fontSize: '0.75rem',
    cursor: 'pointer',
    textDecoration: 'underline',
    display: 'inline-block',
  },
  excluir: {
    marginTop: '0.3rem',
    background: 'none',
    border: 'none',
    color: '#f87171',
    fontSize: '0.75rem',
    cursor: 'pointer',
    textDecoration: 'underline',
    display: 'inline-block',
    marginLeft: '0.5rem',
  },
}