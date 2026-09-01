import { useEffect, useMemo, useState } from 'react'
import { usePonto } from '../hooks/usePonto'
import { estilosComuns, formatoReal, formatarData, hoje } from '../lib/compartilhados'
import ModalFormulario from '../components/ModalFormulario'
import SeletorPeriodo from '../components/planejamento/SeletorPeriodo'
import { definirPeriodo, deslocarPeriodo, ehPeriodoAtual } from '../lib/periodos'
import {
  calcularLancamento,
  classificarTurnoParaUI,
  qtdDiasIntervalo,
  QUOTA_FERIAS_ANUAL,
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
// O resumo do mês soma as exceções + dias de férias; os demais dias contam
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
    criarFerias,
    excluirFerias,
    saldoFerias,
    excluirExcecao,
  } = usePonto(janela)

  // Modal centralizado (padrão das demais páginas): 'trabalho' | 'ferias' | null.
  const [modal, setModal] = useState(null)
  const [data, setData] = useState('')
  const [dataFeriasFim, setDataFeriasFim] = useState('')
  const [entrada, setEntrada] = useState('20:30')
  const [saida, setSaida] = useState('03:00')
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [mensagem, setMensagem] = useState(null)

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

  // Quando o período visível muda (botões mês), o hook recarrega sozinho.
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
    setModal(tipo)
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
      } else {
        await criarExcecaoTrabalho({ dataISO: data, entrada, saida, obs: obs || undefined })
        setMensagem({
          tipo: 'ok',
          texto: `Lançado em ${formatarData(data)} — ${previsao.tipo}.`,
        })
      }
      setData('')
      setDataFeriasFim('')
      setObs('')
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: `Não foi possível lançar: ${err.message}` })
    } finally {
      setEnviando(false)
    }
  }

  async function handleExcluirExcecao(id) {
    try {
      await excluirExcecao(id)
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
            <h3>Resumo do mês</h3>
            {carregando ? (
              <p style={estilosComuns.mensagem}>Carregando...</p>
            ) : (
              <>
                <ul style={estilosResumo.grade}>
                  <li style={estilosResumo.card}>
                    <span style={estilosResumo.rotulo}>Horas de exceção</span>
                    <span style={estilosResumo.valor}>{resumo.horas}h</span>
                    <span style={estilosResumo.meta}>carga esperada {cargaEsperada}h</span>
                  </li>
                  <li style={estilosResumo.card}>
                    <span style={estilosResumo.rotulo}>Hora extra</span>
                    <span style={estilosResumo.valor}>{resumo.he}h</span>
                    <span style={estilosResumo.meta}>
                      {formatoReal.format(resumo.valorHe)} a receber
                    </span>
                  </li>
                  <li style={estilosResumo.card}>
                    <span style={estilosResumo.rotulo}>Domingos/feriados</span>
                    <span style={estilosResumo.valor}>{resumo.domferQtd} dia(s)</span>
                    <span style={estilosResumo.meta}>
                      {formatoReal.format(resumo.valorDomfer)} em diárias
                    </span>
                  </li>
                  <li style={estilosResumo.card}>
                    <span style={estilosResumo.rotulo}>Férias</span>
                    <span style={estilosResumo.valor}>{resumo.diasFerias} dia(s)</span>
                    <span style={estilosResumo.meta}>
                      saldo {saldoFerias(periodo.ano)} de {QUOTA_FERIAS_ANUAL} dias em {periodo.ano}
                    </span>
                  </li>
                </ul>
                <p style={estilosComuns.mensagem}>
                  Dia sem lançamento conta como carga padrão cumprida. Saldo do período:{' '}
                  <strong style={estilosResumo.saldo}>
                    {resumo.horas - cargaEsperada >= 0 ? '+' : ''}
                    {Math.round((resumo.horas - cargaEsperada) * 100) / 100}h
                  </strong>
                </p>
              </>
            )}
          </section>

          {/* ── Lançamentos da semana ─────────────────────────────────── */}
          <section style={estilosComuns.secao}>
            <div style={estilosCabecalho.linha}>
              <h3 style={{ margin: 0 }}>Lançamentos da semana</h3>
              <button
                type="button"
                onClick={() => abrirModal('trabalho')}
                style={estilosComuns.botaoCriar}
              >
                + Lançar avulso
              </button>
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
                        {ex.obs ? ` · ${ex.obs}` : ''}
                      </span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={estilosComuns.saldo}>
                        {Number(ex.horas)}h{Number(ex.he) > 0 ? ` (+${Number(ex.he)} HE)` : ''}
                      </span>
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

      {/* ── Modal padrão do app: lançamento avulso OU férias ─────────── */}
      {modal && (
        <ModalFormulario
          titulo={modal === 'trabalho' ? 'Lançamento avulso' : 'Marcar férias'}
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
            {modal === 'trabalho' && previsao && (
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
                ? 'Lançando...'
                : modal === 'ferias'
                  ? 'Marcar férias'
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

const estilosAcao = {
  excluir: {
    marginTop: '0.3rem',
    background: 'none',
    border: 'none',
    color: '#f87171',
    fontSize: '0.75rem',
    cursor: 'pointer',
    textDecoration: 'underline',
    display: 'block',
    marginLeft: 'auto',
  },
}