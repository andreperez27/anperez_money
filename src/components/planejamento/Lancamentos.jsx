import { useState } from 'react'
import { useMuyEstrecho } from '../../hooks/useMediaQuery'
import { useContas } from '../../hooks/useContas'
import { useCartoes } from '../../hooks/useCartoes'
import ModalFormulario from '../ModalFormulario'
import { estilosComuns, formatoReal, formatarData, hoje } from '../../lib/compartilhados'
import GeradorRecorrenciaMensal from './GeradorRecorrenciaMensal'
import GeradorCondominio from './GeradorCondominio'
import {
  RÓTULO_ESTADO,
  RÓTULO_TIPO,
  ehEntrada,
  ehDisponivel,
  badgeEstado,
  conteudoItem,
  corTipo,
  estilosItem,
} from './comum'

// ============================================================================
// LANÇAMENTOS DO PLANEJAMENTO (ETAPA 06/E5-F4)
// ============================================================================
// Área operacional: formulário de criação (avulsa × parcelada) + lista do
// período com ações. Porto FIEL do comportamento validado na E5-E — as regras
// não mudaram:
//   • criação avulsa → criarPlanejamento; série parcelada → criarSerieParcelada
//     (numerador/datas nascem na lib pura; a UI só envia o conjunto);
//   • badge "3/10" nas linhas de série e tag derivada "Disponível";
//   • CANCELAR ≠ EXCLUIR; cancelamento de série respeita previsto/realizado;
//   • totais/contagens NÃO são recalculados aqui — quem exibe números é a
//     Visão geral; esta aba é edição e listagem.
//
// FORA de escopo até a E5-F: regeneração pela UI. A EFETIVAÇÃO (botão Lançar)
// foi implementada para o caminho de CONTAS via RPC realizar_planejamento;
// a realização em CARTÃO (compra/parcela) permanece para etapa futura.
// Pós-mutação bem-sucedida, aoPosMutacao() avisa a página (que decide se algo
// precisa ser recarregado — nos períodos maiores, refazer a própria faixa).
// ============================================================================

// Lê um número digitado ("1500,00" ou "1500.00") → número em reais.
function lerValor(texto) {
  const n = Number(String(texto).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

export default function Lancamentos({
  itens,
  carregando,
  erro,
  dataPadrao,
  acoes,
  aoPosMutacao,
}) {
  const muyEstrecho = useMuyEstrecho()
  const [erroAcao, setErroAcao] = useState('')

  // Contas disponíveis para o destino da realização (efeitvação). O hook
  // busca todas as contas do usuário; a RLS filtra no banco. Só as ATIVAS
  // aparecem como destino (mesma regra do select de cartões).
  const { contas: contasDisponiveis, carregando: carregandoContas } = useContas()
  // Inclui cartões inativos no "Lançar → Cartão": se o planejamento aponta para
  // um cartão que existe (mesmo que tenha ficado inativo), o lançamento deve
  // funcionar — não se exige cartão ativo, apenas que exista.
  const { cartoes: cartoesDisponiveis, carregando: carregandoCartoes } = useCartoes(null, {
    incluirInativos: true,
  })

  // Efeitvação (Planejado → Realizado): item sendo lançado + payload do modal.
  const [realizando, setRealizando] = useState(null)
  const [realForm, setRealForm] = useState({ destino: 'conta', conta_id: '', cartao_id: '', valor: '', data: '' })
  const [confirmando, setConfirmando] = useState(false)

  // Formulário de criação — avulsa × parcelada × recorrente × condominio.
  const [modo, setModo] = useState('avulsa') // 'avulsa' | 'parcelada' | 'recorrente' | 'condominio'
  const [form, setForm] = useState({
    tipo_op: 'Saida',
    descricao: '',
    valor: '', // avulsa/valor total (reais)
    data_prevista: '', // avulsa
    total_parcelas: '', // parcelada
    data_primeira_parcela: '', // parcelada
    periodicidade: 'mensal', // parcelada: 'mensal' | 'semanal'
    destino: '', // '' | 'conta' | 'cartao' — destino_padrao planejado
    cartao: '', // cartao_padrao_id (quando destino = 'cartao')
  })
  const [formMsg, setFormMsg] = useState({ tipo: '', texto: '' })
  const [criando, setCriando] = useState(false)
  const [mostrandoForm, setMostrandoForm] = useState(false)

  // Edição de destino padrão (Conta/Cartão) de um lançamento JA EXISTENTE —
  // útil para planejamentos já realizados (ex.: seguro do carro) para os quais
  // você quer registrar a informação de qual conta/cartão foi (ou será) usado.
  const [editando, setEditando] = useState(null) // item em edição
  const [editForm, setEditForm] = useState({ destino: '', cartao: '', cartao_tem: false })
  const [salvandoEdicao, setSalvandoEdicao] = useState(false)

  function campoEdit(campoO) {
    setEditForm((f) => ({ ...f, ...campoO }))
    if (erroAcao) setErroAcao('')
  }

  // Modo 'recorrente': despesa fixa mensal genérica (ex.: DAS-MEI, assinaturas).
  // Reutiliza o GeradorRecorrenciaMensal com nome = descrição e calcularValor
  // = valor fixo digitado (origem 'recorrente' no payload).
  const [recForm, setRecForm] = useState({ descricao: '', valor: '', destino: '', cartao: '' })
  const recValor = lerValor(recForm.valor)
  const recNome = recForm.descricao.trim() || 'Recorrente'

  function campoRec(campoO) {
    setRecForm((f) => ({ ...f, ...campoO }))
  }

  function campo(campoO) {
    setForm((f) => ({ ...f, ...campoO }))
    if (formMsg.texto) setFormMsg({ tipo: '', texto: '' })
  }

  // Atualiza o payload do modal de realização (limpando erro de ação local).
  function campoReal(campoO) {
    setRealForm((f) => ({ ...f, ...campoO }))
    if (erroAcao) setErroAcao('')
  }

  async function aoCancelar(item) {
    if (carregando) return
    const ok = window.confirm(
      `Cancelar "${item.descricao}"?\n\nO registro permanece no histórico com estado "cancelado".`,
    )
    if (!ok) return
    try {
      await acoes.cancelar(item.id)
      setErroAcao('')
      await aoPosMutacao?.()
    } catch (e) {
      setErroAcao(`Não foi possível cancelar: ${e.message}`)
    }
  }

  // Cancelamento de resto da série a partir desta parcela (D5). Realizadas e
  // canceladas nunca são tocadas; o domínio usa a lib para calcular o intervalo.
  async function aoCancelarSerie(item) {
    if (carregando) return
    const ehAvulsa = !item.serie_id
    const mensagem = ehAvulsa
      ? `Esta ocorrência é avulsa. Cancelar "${item.descricao}"?`
      : `Cancelar a série a partir da parcela ${item.parcela_numero} de "${item.descricao}"?\n\nSó parcelas "previsto" daqui para frente são canceladas; realizadas não mudam.`
    const ok = window.confirm(mensagem)
    if (!ok) return
    try {
      await acoes.cancelarSerie(item.id)
      setErroAcao('')
      await aoPosMutacao?.()
    } catch (e) {
      setErroAcao(`Não foi possível cancelar a série: ${e.message}`)
    }
  }

  async function aoExcluir(item) {
    if (carregando) return
    const ok = window.confirm(
      `Excluir DEFINITIVAMENTE "${item.descricao}"?\n\nEsta ação não pode ser desfeita.`,
    )
    if (!ok) return
    try {
      await acoes.excluir(item.id)
      setErroAcao('')
      await aoPosMutacao?.()
    } catch (e) {
      setErroAcao(`Não foi possível excluir: ${e.message}`)
    }
  }

  // Efetivação de um item de FATURA automática: chama a RPC pagar_fatura do
  // módulo Cartões (paga a fatura em aberto na conta do cartão). Não é um
  // "Lançar" de planejamento comum — o item é uma projeção dinâmica, não um
  // registro persistido, então a confirmação reforça o pagamento real.
  async function aoEfetivarFatura(item) {
    if (!acoes.realizarFatura) return
    const ok = window.confirm(
      `Pagar a fatura em aberto de "${item.descricao}" ` +
        `(R$ ${formatoReal.format(Number(item.valor))})?`,
    )
    if (!ok) return
    try {
      await acoes.realizarFatura(item)
      setErroAcao('')
      await aoPosMutacao?.()
    } catch (e) {
      setErroAcao(`Não foi possível pagar a fatura: ${e.message}`)
    }
  }

  // Abre o modal de edição de destino (Conta/Cartão) pré-preenchido com o que
  // o lançamento já registra. Vale para itens previstos E realizados.
  function aoAbrirEditar(item) {
    const ehCartao = item.destino_padrao === 'cartao'
    const cartaoValido = ehCartao && !!item.cartao_padrao_id
    setEditando(item)
    setEditForm({
      destino: ehCartao ? 'cartao' : 'conta',
      cartao: cartaoValido ? item.cartao_padrao_id : (cartoesAtivos[0]?.id ?? ''),
      cartao_tem: cartaoValido,
    })
    setErroAcao('')
  }

  // Confirma a edição do destino padrão. Pode definir conta (destino_padrao
  // null/implicito) ou cartão (destino_padrao='cartao' + cartao_padrao_id).
  // Não altera valor/data/estado — só o direcionamento.
  async function aoConfirmarEditar(e) {
    e.preventDefault()
    if (salvandoEdicao) return
    if (editForm.destino === 'cartao' && !editForm.cartao) {
      setErroAcao('Selecione o cartão de destino.')
      return
    }
    try {
      setSalvandoEdicao(true)
      const alteracoes =
        editForm.destino === 'cartao'
          ? { destino_padrao: 'cartao', cartao_padrao_id: editForm.cartao }
          : { destino_padrao: null, cartao_padrao_id: null }
      await acoes.editar(editando.id, alteracoes)
      setErroAcao('')
      setEditando(null)
      await aoPosMutacao?.()
    } catch (err) {
      setErroAcao(`Não foi possível salvar: ${err.message}`)
    } finally {
      setSalvandoEdicao(false)
    }
  }

  // Abre o modal de realização pré-preenchido: conta_destino_id (se a previsão
  // registrou um destino), o valor previsto e a data de hoje. O valor numérico
  // do banco (ex.: 100.5) é exibido como texto "100,5" com vírgula decimal —
  // formato que o lerValor (usado no confirmar) interpreta sem deslocar casas.
  function aoAbrirRealizar(item) {
    // Se a previsão registrou um destino_padrao='cartao' com cartão válido,
    // pré-seleciona o CARTÃO; senão, pré-seleciona a CONTA (comportamento
    // original). É só pré-preenchimento — o usuário troca antes de confirmar.
    const destinoCartao =
      item.destino_padrao === 'cartao' &&
      item.cartao_padrao_id &&
      cartoesAtivos.some((c) => c.id === item.cartao_padrao_id)
    setRealizando(item)
    setRealForm({
      destino: destinoCartao ? 'cartao' : 'conta',
      conta_id: item.conta_destino_id || (contasAtivas[0]?.id ?? ''),
      cartao_id: destinoCartao ? item.cartao_padrao_id : (cartoesAtivos[0]?.id ?? ''),
      valor: String(item.valor).replace('.', ','),
      // Data pré-preenchida com a data_prevista do planejamento: ao efetivar
      // em cartão, a compra é lançada na data prevista → o mês da fatura real
      // da efetivação bate com o mês calculado na PROJEÇÃO da fatura.
      data: item.data_prevista || hoje(),
    })
    setErroAcao('')
  }

  // Confirma a realização. A RPC (migration 16) faz INSERT em movimentacoes +
  // UPDATE para 'realizado' numa única transação; o saldo da conta é ajustado
  // pela trigger trg_atualizar_saldo. Depois do sucesso, aoPosMutacao().
  async function aoConfirmarRealizar(e) {
    e.preventDefault()
    if (confirmando) return
    const valor = lerValor(realForm.valor)
    if (realForm.destino === 'cartao') {
      if (!realForm.cartao_id) {
        setErroAcao('Selecione o cartão de destino.')
        return
      }
    } else if (!realForm.conta_id) {
      setErroAcao('Selecione a conta de destino.')
      return
    }
    if (!Number.isFinite(valor) || valor <= 0) {
      setErroAcao('Informe um valor maior que zero.')
      return
    }
    try {
      setConfirmando(true)
      if (realForm.destino === 'cartao') {
        await acoes.realizarCartao(realizando.id, {
          cartao_id: realForm.cartao_id,
          valor_real: valor,
          data_compra: realForm.data || undefined,
        })
      } else {
        await acoes.realizar(realizando.id, {
          conta_id: realForm.conta_id,
          valor_real: valor,
          data_realizacao: realForm.data || undefined,
        })
      }
      setErroAcao('')
      setRealizando(null)
      await aoPosMutacao?.()
    } catch (e) {
      setErroAcao(`Não foi possível realizar: ${e.message}`)
    } finally {
      setConfirmando(false)
    }
  }

  async function aoCriar(e) {
    e.preventDefault()
    if (criando) return
    const descricao = form.descricao.trim()
    if (!descricao) {
      setFormMsg({ tipo: 'erro', texto: 'Informe a descrição.' })
      return
    }

    try {
      setCriando(true)
      if (modo === 'parcelada') {
        const totalParcelas = Number(form.total_parcelas)
        const valorTotal = lerValor(form.valor)
        if (!Number.isInteger(totalParcelas) || totalParcelas < 1) {
          setFormMsg({ tipo: 'erro', texto: 'Número de parcelas inválido (use inteiro >= 1).' })
          return
        }
        if (!Number.isFinite(valorTotal) || valorTotal <= 0) {
          setFormMsg({ tipo: 'erro', texto: 'Informe um valor total maior que zero.' })
          return
        }
        await acoes.criarSerie({
          tipoOp: form.tipo_op,
          descricao,
          totalCentavos: Math.round(valorTotal * 100),
          totalParcelas,
          dataPrimeiraParcela: form.data_primeira_parcela || dataPadrao,
          periodicidade: form.periodicidade,
          destinoPadrao: form.destino || undefined,
          cartaoPadraoId: form.destino === 'cartao' ? form.cartao || undefined : undefined,
        })
        setForm((f) => ({ ...f, descricao: '', valor: '', total_parcelas: '', data_primeira_parcela: '', destino: '', cartao: '' }))
      } else {
        const valor = lerValor(form.valor)
        if (!Number.isFinite(valor) || valor <= 0) {
          setFormMsg({ tipo: 'erro', texto: 'Informe um valor maior que zero.' })
          return
        }
        await acoes.criar({
          tipo_op: form.tipo_op,
          descricao,
          valor,
          data_prevista: form.data_prevista || dataPadrao,
          destino_padrao: form.destino || undefined,
          cartao_padrao_id: form.destino === 'cartao' ? form.cartao || undefined : undefined,
        })
        setForm((f) => ({ ...f, descricao: '', valor: '', data_prevista: '', destino: '', cartao: '' }))
      }
      await aoPosMutacao?.()
      setMostrandoForm(false)
      setFormMsg({ tipo: '', texto: '' })
    } catch (err) {
      setFormMsg({ tipo: 'erro', texto: `Não foi possível criar: ${err.message}` })
    } finally {
      setCriando(false)
    }
  }

  const criandoOk = formMsg.tipo === 'ok'
  const dataHoje = hoje()

  // Destinos possíveis da realização: apenas contas ATIVAS (conta) e
  // cartões ATIVOS (cartão de crédito) do usuário.
  const contasAtivas = contasDisponiveis.filter((c) => c.ativa)
  // Não exige cartão ATIVO para o "Lançar → Cartão": usa todos os cartões que
  // existem (o hook já vem com incluirInativos:true). Se o destino apontar para
  // um cartão inativo, ainda assim lança nele.
  const cartoesAtivos = cartoesDisponiveis
  const podeCartao = realizando?.tipo_op === 'Saida'

  return (
    <section>
      {/* Criação de planejamento (avulsa × parcelada) em modal centralizado */}
      <div style={estilos.topoAcoes}>
        <button type="button" onClick={() => setMostrandoForm(true)} style={estilosComuns.botaoCriar}>
          + Novo lançamento
        </button>
      </div>

      {mostrandoForm && (
        <ModalFormulario
          titulo="Novo planejamento"
          aoFechar={() => {
            setMostrandoForm(false)
            setFormMsg({ tipo: '', texto: '' })
          }}
        >
        <div style={estilos.toggle}>
          <button
            type="button"
            onClick={() => { setModo('avulsa'); setFormMsg({ tipo: '', texto: '' }) }}
            style={{ ...estilos.pilhaModo, ...(modo === 'avulsa' ? estilos.pilhaModoAtiva : {}) }}
          >
            Avulsa
          </button>
          <button
            type="button"
            onClick={() => { setModo('parcelada'); setFormMsg({ tipo: '', texto: '' }) }}
            style={{ ...estilos.pilhaModo, ...(modo === 'parcelada' ? estilos.pilhaModoAtiva : {}) }}
          >
            Parcelada
          </button>
          <button
            type="button"
            onClick={() => { setModo('recorrente'); setFormMsg({ tipo: '', texto: '' }) }}
            style={{ ...estilos.pilhaModo, ...(modo === 'recorrente' ? estilos.pilhaModoAtiva : {}) }}
          >
            Recorrente
          </button>
          <button
            type="button"
            onClick={() => { setModo('condominio'); setFormMsg({ tipo: '', texto: '' }) }}
            style={{ ...estilos.pilhaModo, ...(modo === 'condominio' ? estilos.pilhaModoAtiva : {}) }}
          >
            Condomínio
          </button>
        </div>

        {(modo === 'avulsa' || modo === 'parcelada') && (
        <form onSubmit={aoCriar} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }} noValidate>
        {modo === 'parcelada' && (
          <div style={estilos.toggle}>
            <button
              type="button"
              onClick={() => campo({ periodicidade: 'mensal' })}
              style={{ ...estilos.pilhaModo, ...(form.periodicidade === 'mensal' ? estilos.pilhaModoAtiva : {}) }}
            >
              Mensal
            </button>
            <button
              type="button"
              onClick={() => campo({ periodicidade: 'semanal' })}
              style={{ ...estilos.pilhaModo, ...(form.periodicidade === 'semanal' ? estilos.pilhaModoAtiva : {}) }}
            >
              Semanal
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <label style={estilos.radioTipo}>
            <input
              type="radio"
              name="tipo_op"
              value="Entrada"
              checked={form.tipo_op === 'Entrada'}
              onChange={() => campo({ tipo_op: 'Entrada' })}
            />
            Entrada
          </label>
          <label style={estilos.radioTipo}>
            <input
              type="radio"
              name="tipo_op"
              value="Saida"
              checked={form.tipo_op === 'Saida'}
              onChange={() => campo({ tipo_op: 'Saida' })}
            />
            Despesa
          </label>
        </div>

        <input
          style={estilosComuns.input}
          placeholder="Descrição"
          value={form.descricao}
          onChange={(e) => campo({ descricao: e.target.value })}
          maxLength={200}
        />

        <div style={estilos.campoDestino}>
          <span style={estilos.rotuloDestino}>Destino padrão na efetivação (opcional)</span>
          <div style={estilos.toggle}>
            <button
              type="button"
              onClick={() => campo({ destino: form.destino === 'conta' ? '' : 'conta' })}
              style={{ ...estilos.pilhaModo, ...(form.destino === 'conta' ? estilos.pilhaModoAtiva : {}) }}
            >
              Conta
            </button>
            <button
              type="button"
              onClick={() => campo({ destino: form.destino === 'cartao' ? '' : 'cartao' })}
              style={{ ...estilos.pilhaModo, ...(form.destino === 'cartao' ? estilos.pilhaModoAtiva : {}) }}
            >
              Cartão
            </button>
          </div>
          {form.destino === 'cartao' && (
            <select
              style={estilosComuns.input}
              value={form.cartao}
              onChange={(e) => campo({ cartao: e.target.value })}
            >
              <option value="" disabled>
                Selecionar cartão
              </option>
              {cartoesAtivos.map((c) => (
                <option key={c.id} value={c.id}>
                  {`${c.nome}${c.contas?.nome ? ` (${c.contas.nome})` : ''}`}
                </option>
              ))}
            </select>
          )}
          {form.destino === 'cartao' && cartoesAtivos.length === 0 && (
            <span style={estilosComuns.mensagemErro}>Nenhum cartão ativo disponível.</span>
          )}
        </div>

        <div style={estilos.camposLadoALado}>
          <label style={estilos.rotuloCampo}>
            {modo === 'parcelada' ? 'Valor total (R$)' : 'Valor (R$)'}
            <input
              style={estilosComuns.input}
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={form.valor}
              onChange={(e) => campo({ valor: e.target.value })}
            />
          </label>
          {modo === 'parcelada' ? (
            <label style={estilos.rotuloCampo}>
              {form.periodicidade === 'semanal' ? 'Quantidade de semanas' : 'Parcelas'}
              <input
                style={estilosComuns.input}
                type="number"
                min="1"
                step="1"
                placeholder="10"
                value={form.total_parcelas}
                onChange={(e) => campo({ total_parcelas: e.target.value })}
              />
            </label>
          ) : (
            <label style={estilos.rotuloCampo}>
              Data
              <input
                style={estilosComuns.input}
                type="date"
                value={form.data_prevista}
                onChange={(e) => campo({ data_prevista: e.target.value })}
              />
            </label>
          )}
        </div>

        {modo === 'parcelada' && (
          <label style={estilos.rotuloCampo}>
            Data da 1ª parcela
            <input
              style={estilosComuns.input}
              type="date"
              value={form.data_primeira_parcela}
              onChange={(e) => campo({ data_primeira_parcela: e.target.value })}
            />
          </label>
        )}

        {formMsg.texto && (
          <p style={criandoOk ? estilosComuns.mensagemOk : estilosComuns.mensagemErro}>
            {formMsg.texto}
          </p>
        )}

        <button type="submit" disabled={criando} style={criando ? estilos.botaoCriando : estilosComuns.botaoCriar}>
          {criando ? 'Criando...' : modo === 'parcelada' ? 'Criar série' : 'Criar planejamento'}
        </button>
        </form>
        )}

        {modo === 'recorrente' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <GeradorRecorrenciaMensal
              nome={recNome}
              tipoOp="Saida"
              destinoPadrao={recForm.destino || undefined}
              cartaoPadraoId={recForm.destino === 'cartao' ? recForm.cartao || undefined : undefined}
              calcularValor={() => ({ total: recValor, detalhamento: [] })}
              aoCriar={acoes.criar}
              aoPosMutacao={aoPosMutacao}
            >
              <label style={estilos.rotuloCampo}>
                Descrição
                <input
                  style={estilosComuns.input}
                  placeholder="Ex.: DAS-MEI, Netflix"
                  value={recForm.descricao}
                  onChange={(e) => setRecForm((f) => ({ ...f, descricao: e.target.value }))}
                  maxLength={200}
                />
              </label>
              <label style={estilos.rotuloCampo}>
                Valor fixo (R$)
                <input
                  style={estilosComuns.input}
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={recForm.valor}
                  onChange={(e) => setRecForm((f) => ({ ...f, valor: e.target.value }))}
                />
              </label>
              <div style={{ ...estilos.rotuloCampo, gridColumn: '1 / -1' }}>
                <span style={estilos.rotuloDestino}>Destino padrão na efetivação (opcional)</span>
                <div style={estilos.toggle}>
                  <button
                    type="button"
                    onClick={() => setRecForm((f) => ({ ...f, destino: f.destino === 'conta' ? '' : 'conta' }))}
                    style={{ ...estilos.pilhaModo, ...(recForm.destino === 'conta' ? estilos.pilhaModoAtiva : {}) }}
                  >
                    Conta
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecForm((f) => ({ ...f, destino: f.destino === 'cartao' ? '' : 'cartao' }))}
                    style={{ ...estilos.pilhaModo, ...(recForm.destino === 'cartao' ? estilos.pilhaModoAtiva : {}) }}
                  >
                    Cartão
                  </button>
                </div>
                {recForm.destino === 'cartao' && (
                  <select
                    style={estilosComuns.input}
                    value={recForm.cartao}
                    onChange={(e) => setRecForm((f) => ({ ...f, cartao: e.target.value }))}
                  >
                    <option value="" disabled>
                      Selecionar cartão
                    </option>
                    {cartoesAtivos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {`${c.nome}${c.contas?.nome ? ` (${c.contas.nome})` : ''}`}
                      </option>
                    ))}
                  </select>
                )}
                {recForm.destino === 'cartao' && cartoesAtivos.length === 0 && (
                  <span style={estilosComuns.mensagemErro}>Nenhum cartão ativo disponível.</span>
                )}
              </div>
            </GeradorRecorrenciaMensal>
            <p style={{ color: '#9ca3af', fontSize: '0.85rem' }}>
              O DAS-MEI e assinaturas mensais (Netflix, HBO, Vivo) entram aqui:
              valor fixo todo mês, gerado como origem 'recorrente'.
            </p>
          </div>
        )}

        {modo === 'condominio' && (
          <GeradorCondominio aoCriar={acoes.criar} aoPosMutacao={aoPosMutacao} />
        )}
        </ModalFormulario>
      )}

      {/* Realização (Planejado → Realizado): escolha de conta destino, valor
          efetivo e data. O confirmar dispara a RPC atômica no banco. */}
      {realizando && (
        <ModalFormulario
          titulo="Realizar lançamento"
          aoFechar={() => {
            if (!confirmando) setRealizando(null)
          }}
        >
          <form onSubmit={aoConfirmarRealizar} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }} noValidate>
            <p style={{ ...estilosComuns.mensagem, margin: 0 }}>
              Lançar <strong style={{ color: '#e5e7eb' }}>{realizando.descricao}</strong>{' '}
              ({formatoReal.format(Number(realizando.valor))}).
            </p>

            {podeCartao && (
              <div style={estilos.toggle}>
                <button
                  type="button"
                  onClick={() => campoReal({ destino: 'conta' })}
                  style={{ ...estilos.pilhaModo, ...(realForm.destino === 'conta' ? estilos.pilhaModoAtiva : {}) }}
                >
                  Conta
                </button>
                <button
                  type="button"
                  onClick={() => campoReal({ destino: 'cartao' })}
                  style={{ ...estilos.pilhaModo, ...(realForm.destino === 'cartao' ? estilos.pilhaModoAtiva : {}) }}
                >
                  Cartão
                </button>
              </div>
            )}

            {realForm.destino === 'conta' ? (
              <label style={estilos.rotuloCampo}>
                Conta de destino
                {carregandoContas ? (
                  <span style={estilosComuns.mensagem}>Carregando contas...</span>
                ) : (
                  <select
                    style={estilosComuns.input}
                    value={realForm.conta_id}
                    onChange={(e) => campoReal({ conta_id: e.target.value })}
                  >
                    <option value="" disabled>
                      Selecionar conta
                    </option>
                    {contasAtivas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                )}
                {contasAtivas.length === 0 && !carregandoContas && (
                  <span style={estilosComuns.mensagemErro}>
                    Nenhuma conta ativa para receber o lançamento.
                  </span>
                )}
              </label>
            ) : (
              <label style={estilos.rotuloCampo}>
                Cartão de destino (compra à vista)
                {carregandoCartoes ? (
                  <span style={estilosComuns.mensagem}>Carregando cartões...</span>
                ) : (
                  <select
                    style={estilosComuns.input}
                    value={realForm.cartao_id}
                    onChange={(e) => campoReal({ cartao_id: e.target.value })}
                  >
                    <option value="" disabled>
                      Selecionar cartão
                    </option>
                    {cartoesAtivos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {`${c.nome}${c.contas?.nome ? ` (${c.contas.nome})` : ''}`}
                      </option>
                    ))}
                  </select>
                )}
                {cartoesAtivos.length === 0 && !carregandoCartoes && (
                  <span style={estilosComuns.mensagemErro}>
                    Nenhum cartão ativo para receber a compra.
                  </span>
                )}
              </label>
            )}

            <div style={estilos.camposLadoALado}>
              <label style={estilos.rotuloCampo}>
                Valor (R$)
                <input
                  style={estilosComuns.input}
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={realForm.valor}
                  onChange={(e) => campoReal({ valor: e.target.value })}
                />
              </label>
              <label style={estilos.rotuloCampo}>
                Data
                <input
                  style={estilosComuns.input}
                  type="date"
                  value={realForm.data}
                  onChange={(e) => campoReal({ data: e.target.value })}
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={confirmando || (realForm.destino === 'cartao' ? cartoesAtivos.length === 0 : contasAtivas.length === 0)}
              style={confirmando ? estilos.botaoCriando : estilosComuns.botaoCriar}
            >
              {confirmando ? 'Realizando...' : 'Confirmar lançamento'}
            </button>
          </form>
        </ModalFormulario>
      )}

      {/* Edição de destino padrão (Conta/Cartão) — vale também para lançamentos
          JÁ realizados (ex.: seguro do carro), onde se registra a informação de
          qual conta ou cartão usou (ou usará). Só altera o direcionamento. */}
      {editando && (
        <ModalFormulario
          titulo="Editar destino"
          aoFechar={() => {
            if (!salvandoEdicao) setEditando(null)
          }}
        >
          <form onSubmit={aoConfirmarEditar} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }} noValidate>
            <p style={{ ...estilosComuns.mensagem, margin: 0 }}>
              Registrar o destino de <strong style={{ color: '#e5e7eb' }}>{editando.descricao}</strong>.
            </p>

            <div style={estilos.toggle}>
              <button
                type="button"
                onClick={() => campoEdit({ destino: 'conta' })}
                style={{ ...estilos.pilhaModo, ...(editForm.destino === 'conta' ? estilos.pilhaModoAtiva : {}) }}
              >
                Conta
              </button>
              <button
                type="button"
                onClick={() => campoEdit({ destino: 'cartao' })}
                style={{ ...estilos.pilhaModo, ...(editForm.destino === 'cartao' ? estilos.pilhaModoAtiva : {}) }}
              >
                Cartão
              </button>
            </div>

            {editForm.destino === 'cartao' && (
              <label style={estilos.rotuloCampo}>
                Cartão de destino
                {carregandoCartoes ? (
                  <span style={estilosComuns.mensagem}>Carregando cartões...</span>
                ) : (
                  <select
                    style={estilosComuns.input}
                    value={editForm.cartao}
                    onChange={(e) => campoEdit({ cartao: e.target.value })}
                  >
                    <option value="" disabled>
                      Selecionar cartão
                    </option>
                    {cartoesAtivos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {`${c.nome}${c.contas?.nome ? ` (${c.contas.nome})` : ''}`}
                      </option>
                    ))}
                  </select>
                )}
                {cartoesAtivos.length === 0 && !carregandoCartoes && (
                  <span style={estilosComuns.mensagemErro}>Nenhum cartão ativo disponível.</span>
                )}
              </label>
            )}

            <p style={{ color: '#9ca3af', fontSize: '0.8rem', margin: 0 }}>
              {editForm.destino === 'cartao'
                ? 'O destino fica como cartão de crédito (pré-seleção no Lançar).'
                : 'O destino fica como conta bancária.'}
            </p>

            <button
              type="submit"
              disabled={salvandoEdicao || (editForm.destino === 'cartao' && cartoesAtivos.length === 0)}
              style={salvandoEdicao ? estilos.botaoCriando : estilosComuns.botaoCriar}
            >
              {salvandoEdicao ? 'Salvando...' : 'Salvar destino'}
            </button>
          </form>
        </ModalFormulario>
      )}

      {erroAcao && <p style={{ ...estilosComuns.mensagemErro, marginTop: '1rem' }}>{erroAcao}</p>}

      {carregando && <p style={{ ...estilosComuns.mensagem, marginTop: '1rem' }}>Carregando lançamentos...</p>}
      {!carregando && erro && (
        <div style={{ marginTop: '1rem' }}>
          <p style={estilosComuns.erro}>{erro}</p>
          <p style={estilosComuns.mensagem}>Tente navegar para outro período e voltar.</p>
        </div>
      )}
      {!carregando && !erro && itens.length === 0 && (
        <div style={estilos.vazio}>
          <p style={{ ...estilosComuns.mensagem, margin: 0 }}>
            Nenhum planejamento neste período.
          </p>
          <p style={{ ...estilosComuns.mensagem, margin: 0, fontSize: '0.85rem' }}>
            Use ‹ › para consultar outros períodos ou cadastre acima.
          </p>
        </div>
      )}

      {!carregando && !erro && itens.length > 0 && (
        <ul style={{ ...estilosItem.lista, marginTop: '1rem' }}>
          {itens.map((item) => {
            const disponivel = ehDisponivel(item, dataHoje)
            const ehSerie = !!item.serie_id
            const ehFatura = item.fatura === true
            const ehFaturaReal = ehFatura && item.tipo === 'real'
            const ehFaturaProjetada = ehFatura && item.tipo === 'projetada'
            const destinoCartao =
              item.estado === 'previsto' &&
              item.destino_padrao === 'cartao' &&
              !!item.cartao_padrao_id
            const cartaoDestino = destinoCartao
              ? cartoesAtivos.find((c) => c.id === item.cartao_padrao_id)
              : null
            return (
              <li key={item.id} style={muyEstrecho ? estilosItem.itemMobile : estilosItem.item}>
                {muyEstrecho ? (
                  <>
                    <div style={estilosItem.linhaMobileTopo}>
                      <span style={estilosItem.data}>{formatarData(item.data_prevista)}</span>
                      <span style={estilosItem.topoDireita}>
                        {ehSerie && (
                          <span style={estilosItem.badgeParcela}>
                            {item.parcela_numero}/{item.total_parcelas}
                          </span>
                        )}
                        {ehFaturaReal && (
                          <span style={estilosItem.badgeFatura}>Fatura</span>
                        )}
                        {ehFaturaProjetada && (
                          <span style={estilosItem.badgeProjecao}>Projeção</span>
                        )}
                        {destinoCartao && (
                          <span style={estilosItem.badgeDestinoCartao} title="Destino planejado: cartão de crédito (ainda não efetivado)">
                            Cartão{cartaoDestino ? `: ${cartaoDestino.nome}` : ''}
                          </span>
                        )}
                        {disponivel && (
                          <span style={estilosItem.badgeDisponivel}>Disponível</span>
                        )}
                        <span style={badgeEstado(item.estado)}>
                          {RÓTULO_ESTADO[item.estado] ?? item.estado}
                        </span>
                      </span>
                    </div>
                    <div style={conteudoItem(item)}>{item.descricao}</div>
                    <div style={estilosItem.linhaMobileBase}>
                      <span style={corTipo(item.tipo_op)}>
                        {RÓTULO_TIPO(item.tipo_op)} · {formatoReal.format(Number(item.valor))}
                      </span>
                      <span style={estilosItem.acoes}>
                        {ehFaturaReal ? (
                          <button type="button" onClick={() => aoEfetivarFatura(item)} title="Pagar a fatura em aberto do cartão (valor real)" style={estilosItem.botaoAcaoFatura}>Pagar fatura</button>
                        ) : ehFaturaProjetada ? (
                          <span style={estilosItem.botaoAcaoNeutro}>Projeção</span>
                        ) : (
                          <>
                            {item.estado === 'previsto' && (
                              <button type="button" onClick={() => aoAbrirRealizar(item)} title="Lançar em conta (realizar)" style={estilosItem.botaoAcaoRealizar}>Lançar</button>
                            )}
                            {item.estado !== 'cancelado' && (
                              <button type="button" onClick={() => aoAbrirEditar(item)} title="Editar destino (Conta/Cartão)" style={estilosItem.botaoAcaoNeutro}>Editar</button>
                            )}
                            {item.estado !== 'cancelado' && (
                              <button type="button" onClick={() => aoCancelar(item)} title="Cancelar esta ocorrência" style={estilosItem.botaoAcaoNeutro}>Cancelar</button>
                            )}
                            {item.estado !== 'cancelado' && ehSerie && (
                              <button type="button" onClick={() => aoCancelarSerie(item)} title="Cancelar série a partir desta parcela" style={estilosItem.botaoAcaoSerie}>Série</button>
                            )}
                            <button type="button" onClick={() => aoExcluir(item)} title="Excluir definitivamente" style={estilosItem.botaoAcaoExcluir}>Excluir</button>
                          </>
                        )}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <span style={estilosItem.data}>{formatarData(item.data_prevista)}</span>
                    <span style={conteudoItem(item)}>
                      {item.descricao}
                      {ehSerie && (
                        <span style={{ ...estilosItem.badgeParcela, marginLeft: '0.5rem' }}>
                          {item.parcela_numero}/{item.total_parcelas}
                        </span>
                      )}
                      {ehFaturaReal && (
                        <span style={{ ...estilosItem.badgeFatura, marginLeft: '0.5rem' }}>Fatura</span>
                      )}
                      {ehFaturaProjetada && (
                        <span style={{ ...estilosItem.badgeProjecao, marginLeft: '0.5rem' }}>Projeção</span>
                      )}
                      {destinoCartao && (
                        <span style={{ ...estilosItem.badgeDestinoCartao, marginLeft: '0.5rem' }} title="Destino planejado: cartão de crédito (ainda não efetivado)">
                          Cartão{cartaoDestino ? `: ${cartaoDestino.nome}` : ''}
                        </span>
                      )}
                      {disponivel && (
                        <span style={{ ...estilosItem.badgeDisponivel, marginLeft: '0.5rem' }}>
                          Disponível
                        </span>
                      )}
                    </span>
                    <span style={corTipo(item.tipo_op)}>{RÓTULO_TIPO(item.tipo_op)}</span>
                    <span style={{ ...estilosItem.valor, color: ehEntrada(item.tipo_op) ? '#4ade80' : '#f87171' }}>
                      {formatoReal.format(Number(item.valor))}
                    </span>
                    <span style={badgeEstado(item.estado)}>{RÓTULO_ESTADO[item.estado] ?? item.estado}</span>
                    <span style={estilosItem.acoes}>
                      {ehFaturaReal ? (
                        <button type="button" onClick={() => aoEfetivarFatura(item)} title="Pagar a fatura em aberto do cartão (valor real)" style={estilosItem.botaoAcaoFatura}>Pagar fatura</button>
                      ) : ehFaturaProjetada ? (
                        <span style={estilosItem.botaoAcaoNeutro}>Projeção</span>
                      ) : (
                        <>
                          {item.estado === 'previsto' && (
                            <button type="button" onClick={() => aoAbrirRealizar(item)} title="Lançar em conta (realizar)" style={estilosItem.botaoAcaoRealizar}>Lançar</button>
                          )}
                          {item.estado !== 'cancelado' && (
                            <button type="button" onClick={() => aoAbrirEditar(item)} title="Editar destino (Conta/Cartão)" style={estilosItem.botaoAcaoNeutro}>Editar</button>
                          )}
                          {item.estado !== 'cancelado' && (
                            <button type="button" onClick={() => aoCancelar(item)} title="Cancelar esta ocorrência" style={estilosItem.botaoAcaoNeutro}>Cancelar</button>
                          )}
                          {item.estado !== 'cancelado' && ehSerie && (
                            <button type="button" onClick={() => aoCancelarSerie(item)} title="Cancelar série a partir desta parcela" style={estilosItem.botaoAcaoSerie}>Série</button>
                          )}
                          <button type="button" onClick={() => aoExcluir(item)} title="Excluir definitivamente" style={estilosItem.botaoAcaoExcluir}>Excluir</button>
                        </>
                      )}
                    </span>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const estilos = {
  topoAcoes: { display: 'flex', justifyContent: 'flex-start', marginBottom: '0.75rem' },
  toggle: { display: 'flex', gap: '0.5rem' },
  pilhaModo: {
    padding: '0.35rem 0.9rem',
    borderRadius: '999px',
    border: '1px solid #374151',
    background: 'transparent',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '0.85rem',
  },
  pilhaModoAtiva: { color: '#42A5F5', borderColor: 'rgba(66, 165, 245, 0.45)' },
  radioTipo: { display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#e5e7eb', cursor: 'pointer', fontSize: '0.9rem' },
  camposLadoALado: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap' },
  rotuloCampo: { display: 'flex', flexDirection: 'column', gap: '0.25rem', color: '#9ca3af', fontSize: '0.8rem', flex: '1 1 130px' },
  botaoCriando: { ...estilosComuns.botaoCriar, opacity: 0.6, cursor: 'default' },
  campoDestino: { display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  rotuloDestino: { color: '#9ca3af', fontSize: '0.8rem' },
  vazio: { padding: '1.25rem', borderRadius: '10px', background: '#111827', border: '1px dashed #374151', display: 'flex', flexDirection: 'column', gap: '0.35rem', textAlign: 'center' },
}
