import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useContas } from '../hooks/useContas'
import { useMovimentacoes, buscarSaldoAntesDe } from '../hooks/useMovimentacoes'
import { useContaAtiva } from '../context/ContaAtivaContext'
import SeletorPeriodo from '../components/SeletorPeriodo'
import { estilosComuns, formatarData, formatoReal, hoje } from '../lib/compartilhados'

// Datas (ISO yyyy-mm-dd) do mês corrente deslocado de `deslocamento`
// (0 = atual, -1 = anterior). MesAtual termina HOJE; MesAnterior vai até
// o último dia do mês.
function inicioDoMes(deslocamento = 0) {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + deslocamento)
  return d.toISOString().slice(0, 10)
}

function fimDoMes(deslocamento = 0) {
  const d = new Date()
  d.setMonth(d.getMonth() + deslocamento + 1)
  d.setDate(0)
  return d.toISOString().slice(0, 10)
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

  const { movimentacoes, carregando, erro, criarMovimentacao, editarMovimentacao, excluirMovimentacao } =
    useMovimentacoes(filtros)

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

  // Resumo do período (somente dos lançamentos exibidos).
  const resumo = useMemo(() => {
    const entradas = movimentacoes
      .filter((m) => m.tipo_op === 'Entrada')
      .reduce((s, m) => s + Number(m.valor), 0)
    const saidas = movimentacoes
      .filter((m) => m.tipo_op === 'Saida')
      .reduce((s, m) => s + Number(m.valor), 0)
    return { entradas, saidas, saldo: entradas - saidas }
  }, [movimentacoes])

  const [mostrandoNova, setMostrandoNova] = useState(false)
  const [movEmEdicao, setMovEmEdicao] = useState(null)
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

            <SeletorPeriodo
              valor={periodo}
              aoTrocarPeriodo={setPeriodo}
              dataInicio={personalizado.dataInicio}
              dataFim={personalizado.dataFim}
              aoTrocarDataInicio={(v) => setPersonalizado((p) => ({ ...p, dataInicio: v }))}
              aoTrocarDataFim={(v) => setPersonalizado((p) => ({ ...p, dataFim: v }))}
            />
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
                    {/* Resumo do período */}
                    <div style={estilos.resumoGrupo}>
                      <div style={estilos.resumoCard}>
                        <span style={estilos.resumoRotulo}>Entradas</span>
                        <strong style={{ ...estilos.resumoValor, color: '#4ade80' }}>
                          {formatoReal.format(resumo.entradas)}
                        </strong>
                      </div>
                      <div style={estilos.resumoCard}>
                        <span style={estilos.resumoRotulo}>Saídas</span>
                        <strong style={{ ...estilos.resumoValor, color: '#f87171' }}>
                          {formatoReal.format(resumo.saidas)}
                        </strong>
                      </div>
                      <div style={estilos.resumoCard}>
                        <span style={estilos.resumoRotulo}>Saldo do período</span>
                        <strong style={{ ...estilos.resumoValor, color: '#42A5F5' }}>
                          {formatoReal.format(resumo.saldo)}
                        </strong>
                      </div>
                    </div>

                    {/* Saldo de abertura (quando o período tem início) */}
                    {saldoAbertura !== null && (
                      <div style={estilos.abertura}>
                        <span>SALDO DE ABERTURA</span>
                        <strong>{formatoReal.format(saldoAbertura)}</strong>
                      </div>
                    )}

                                        {/* Cabeçalho da tabela (fica fixo; só as linhas rolam) */}
                    <div style={estilos.tabelaCabecalho}>
                      <span style={estilos.gradeCabecalho}>Data</span>
                      <span style={{ ...estilos.gradeCabecalho, borderLeft: '1px solid #374151' }}>
                        Descrição
                      </span>
                      <span style={{ ...estilos.gradeCabecalho, borderLeft: '1px solid #374151' }}>
                        Débito
                      </span>
                      <span style={{ ...estilos.gradeCabecalho, borderLeft: '1px solid #374151' }}>
                        Crédito
                      </span>
                      <span style={{ ...estilos.gradeCabecalho, borderLeft: '1px solid #374151' }}>
                        Ações
                      </span>
                    </div>

                    <ul style={estilosComuns.lista}>
                      {movimentacoes.map((mov) => {
                        const ehEntrada = mov.tipo_op === 'Entrada'
                        // Movimentações ligadas a caixinhas (categoria
                        // 'caixinha', criadas por caixinha_guardar/resgatar)
                        // não podem ser editadas/excluídas direto: o
                        // vínculo é gerenciado pela própria caixinha.
                        const ehCaixinha = mov.categoria === 'caixinha'
                        return (
                          <li key={mov.id} style={estilos.tabelaLinha}>
                            <span style={estilos.celulaData}>
                              {formatarData(mov.data)}
                            </span>
                            <span style={{ ...estilos.celulaDescricao, borderLeft: '1px solid #1f2937' }}>
                              <span style={estilosComuns.nomeConta}>{mov.descricao}</span>
                              {mov.categoria && (
                                <span style={estilosComuns.tipoConta}>{mov.categoria}</span>
                              )}
                            </span>
                            <span style={{ ...estilos.celulaValor, color: '#f87171', borderLeft: '1px solid #1f2937' }}>
                              {ehEntrada ? '' : formatoReal.format(Number(mov.valor))}
                            </span>
                            <span style={{ ...estilos.celulaValor, color: '#4ade80', borderLeft: '1px solid #1f2937' }}>
                              {ehEntrada ? formatoReal.format(Number(mov.valor)) : ''}
                            </span>
                            <span style={{ ...estilos.celulaAcoes, borderLeft: '1px solid #1f2937' }}>
                              {ehCaixinha ? (
                                <span style={estilos.cadeado} title="Movimentação de caixinha — gerencie pelos botões da caixinha">🔒</span>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => iniciarEdicao(mov)}
                                    style={estilos.botaoAcao}
                                    title="Editar movimentação"
                                  >
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleExcluir(mov)}
                                    style={{ ...estilos.botaoAcao, color: '#f87171' }}
                                    title="Excluir movimentação"
                                  >
                                    Excluir
                                  </button>
                                </>
                              )}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )}
              </>
            )}
          </section>
        </>
      )}

      {/* Formulário: nova movimentação OU edição (mesmo formulário,
        pré-preenchido via iniciarEdicao). Aberto pelo FAB; lança na conta ativa. */}
      {mostrandoNova && contaAtiva && (
        <section style={{ ...estilosComuns.secao, maxWidth: '340px', marginBottom: '3.5rem' }}>
          <div style={estilos.topo}>
            <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
              {movEmEdicao ? 'Editar movimentação' : 'Nova movimentação'}
            </h3>
            {movEmEdicao && (
              <button
                type="button"
                onClick={abrirFormularioNova}
                style={estilos.botaoCancelar}
                title="Cancelar edição"
              >
                ✕
              </button>
            )}
          </div>
          <form onSubmit={handleSalvarMovimentacao} style={{ ...estilosComuns.form, maxWidth: '360px' }}>
            <p style={estilosComuns.mensagem}>
              Conta: <strong>{contaAtiva.nome}</strong> —{' '}
              {formatoReal.format(Number(contaAtiva.saldo_atual))}
            </p>
            {/* Linha 1: Tipo | Data | Valor. Linha 2: Descrição (2/3) +
                Categoria (1/3). Grade única de 3 colunas. */}
            <div style={estilos.gradeLancamento}>
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
        </section>
      )}

      {contaAtiva && (
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
          style={estilos.botaoNova}
          aria-expanded={mostrandoNova}
        >
          {mostrandoNova ? '−' : '+'} Nova movimentação
        </button>
      )}
    </div>
  )
}

const estilos = {
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
  resumoGrupo: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' },
  resumoCard: {
    flex: '1 1 120px',
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: '10px',
    padding: '0.75rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  resumoRotulo: { color: '#9ca3af', fontSize: '0.75em' },
  resumoValor: { fontSize: '1em', fontWeight: 'bold' },
  abertura: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 0.9rem',
    borderRadius: '10px',
    border: '1px dashed #374151',
    background: '#111827',
    color: '#9ca3af',
    fontSize: '0.78rem',
    letterSpacing: '0.04em',
    marginBottom: '0.75rem',
  },
  // Extrato em tabela, como no app antigo: Data | Descrição | Débito |
  // Crédito | Ações, com colunas separadas por linha vertical (estilo
  // planilha) e textos centralizados nas células.
  tabelaCabecalho: {
    display: 'grid',
    gridTemplateColumns: '88px 1fr 92px 92px 78px',
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
    gridTemplateColumns: '88px 1fr 92px 92px 78px',
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
    textAlign: 'center',
    padding: '0 0.5rem',
  },
  celulaValor: {
    fontWeight: 'bold',
    fontSize: '0.78rem',
    textAlign: 'center',
    whiteSpace: 'nowrap',
    padding: '0 0.5rem',
  },
  celulaAcoes: {
    display: 'flex',
    gap: '0.25rem',
    justifyContent: 'center',
    padding: '0 0.25rem',
  },
  botaoAcao: {
    background: 'transparent',
    border: '1px solid #374151',
    borderRadius: '6px',
    color: '#42A5F5',
    fontFamily: 'inherit',
    fontSize: '0.68rem',
    fontWeight: 'bold',
    padding: '0.15rem 0.35rem',
    cursor: 'pointer',
  },
  cadeado: {
    fontSize: '0.7rem',
    cursor: 'default',
    opacity: 0.6,
  },
  botaoCancelar: {
    background: 'transparent',
    border: 'none',
    color: '#9ca3af',
    fontFamily: 'inherit',
    fontWeight: 'bold',
    fontSize: '0.9rem',
    cursor: 'pointer',
    padding: '0.1rem 0.3rem',
  },
  // Linha 1: Tipo | Data | Valor — lado a lado. Linha 2: Descrição (2
  // colunas) + Categoria. Formulário compacto para o botão nunca ficar
  // fora da tela.
  gradeLancamento: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '0.6rem',
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
    boxShadow: '0 4px 14px rgba(66, 165, 245, 0.35)',
    zIndex: 5,
  },
}