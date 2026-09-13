// ============================================================================
// REATIVADO em 31/08/2026: renderizado dentro do modal "Novo planejamento"
// (Lancamentos.jsx), na opção [Condomínio]. Antes ficava em aba dedicada; foi
// consolidado no formulário padrão (decisão com André). A aba superior
// Condomínio NÃO existe mais — o form é aberto pela pilha [Condomínio].
// ============================================================================
import { useCallback, useEffect, useState } from 'react'
import { useDespesaRecorrenteItens } from '../../hooks/useDespesaRecorrenteItens'
import { estilosComuns, hoje } from '../../lib/compartilhados'
import { calcularTotalCondominio } from '../../lib/despesaRecorrenteCalc'
import { projetarValorVariavel } from '../../lib/mediaMovelCalc'
import { extrairHistoricosVariaveis } from '../../lib/serieValorVariavel'
import { supabase } from '../../lib/supabaseClient'
import GeradorRecorrenciaMensal from './GeradorRecorrenciaMensal'
import ModalNovoItemFixo from './ModalNovoItemFixo'

// ============================================================================
// GERADOR DE CONDOMÍNIO (ETAPA 06/P4 — sobre GeradorRecorrenciaMensal)
// ============================================================================
// Substitui o gerar_boletos.py (planilha Boletos.xlsx + JSON solto no Windows):
// monta a previsão mensal de condomínio como uma previsão do Planejamento com
// origem = 'recorrente'.
//
// O formulário (mês/ano + vencimento + total + botão "Gerar previsão do mês")
// VIVE no componente reutilizável GeradorRecorrenciaMensal. Aqui ficam só as
// partes específicas do condomínio:
//   • gerenciamento dos itens FIXOS (tabela despesa_recorrente_item): listagem
//     vigente no mês, novo item (nova vigência) via ModalNovoItemFixo
//     (compartilhado com o consumo real da ocorrência — vigência SÓ no hook);
//   • os campos VARIÁVEIS (Consumo de Gás e Água) — passados como children do
//     formulário, com estado local aqui;
//   • calcularValor(mes) = soma itens fixos vigentes + variáveis (a MESMA
//     função pura calcularTotalCondominio de sempre).
//
// O CONSUMO REAL (informar leituras/valores de Gás/Água p/ corrigir a previsão)
// NÃO mora mais aqui (13/09/2026): passou pra ação "Inserir consumo real" da
// OCORRÊNCIA prevista de Condomínio (ConsumoRealOcorrencia.jsx), evitando dois
// lugares com a mesma responsabilidade.
//
// O resultado usa o fluxo EXISTENTE de criação de previsão (criarPlanejamento):
// a data/valor/observação são montados pelo GeradorRecorrenciaMensal. A
// previsão aparece na tela do Planejamento como qualquer outra ('previsto') e
// é efetivada pelo MESMO botão "Lançar" de sempre. Este form não move saldo e
// não toca em Cartões.
// ============================================================================

// Lê um número digitado ("124,08" ou "124.08") → número em reais (padrão app).
function lerValor(texto) {
  const n = Number(String(texto).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

const MES_3 = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ']

export default function GeradorCondominio({ aoCriarSerie, aoCriar, aoPosMutacao, contas = [] }) {
  const { carregando: carregandoItens, erro: erroItens, listar, criarItem } =
    useDespesaRecorrenteItens()

  // Mês de referência (input month 'YYYY-MM'); default = mês corrente.
  // Mantido AQUI para filtrar a vigência dos itens fixos e dar o rótulo.
  const [mesAno, setMesAno] = useState(() => hoje().slice(0, 7))
  const [gas, setGas] = useState('')
  const [agua, setAgua] = useState('')
  const [contaId, setContaId] = useState('')
  const [itensVigentes, setItensVigentes] = useState([])

  // Modal de cadastro de item fixo (nova vigência). A lógica mora no hook
  // criarItem — reutilizado com o MESMO componente da ocorrência de consumo.
  const [mostrandoItem, setMostrandoItem] = useState(false)

  // Busca os itens fixos VIGENTES no mês de referência sempre que ele muda.
  useEffect(() => {
    let ativo = true
    const ultimo = ultimoDia(mesAno)
    listar(ultimo)
      .then((dados) => {
        if (ativo) setItensVigentes(dados)
      })
      .catch(() => {
        if (ativo) setItensVigentes([])
      })
    return () => {
      ativo = false
    }
  }, [mesAno, listar])

  const [anoAtual, mesAtual] = mesAno.split('-').map(Number)
  const rotuloMes = `${MES_3[mesAtual - 1]}/${anoAtual}`

  // MÉDIA MÓVEL (P5): pré-preenche Gás/Água com os últimos 3 valores REALIZADOS
  // de condomínio (origem 'recorrente') seguindo a regra definitiva de valor
  // variável (08/09/2026): 3+ reais → média dos 3 últimos; menos de 3 → repete
  // o último real. É só um SUGESTÃO — os campos ficam editáveis e nunca
  // travados; o usuário decide o valor final. Não há mudança de schema: a
  // leitura usa a observação já gravada (códigos 1010/1052).
  useEffect(() => {
    let ativo = true
    carregarMediaMovel()
      .then(({ gas, agua }) => {
        if (!ativo) return
        if (Number.isFinite(gas) && gas > 0) setGas(String(gas).replace('.', ','))
        if (Number.isFinite(agua) && agua > 0) setAgua(String(agua).replace('.', ','))
      })
      .catch(() => {}) // falha na sugestão não bloqueia o formulário
    return () => {
      ativo = false
    }
  }, [])

  async function carregarMediaMovel() {
    const { data, error } = await supabase
      .from('planejamentos')
      .select('data_prevista, observacao')
      .eq('estado', 'realizado')
      .eq('origem', 'recorrente')
      .ilike('descricao', 'Condomínio%')
      .order('data_prevista', { ascending: false })
      .limit(60)
    if (error) throw new Error(error.message)

    // Extração única do histórico (dedupe por mês + ordem cronológica) fica na
    // lib serieValorVariavel — a MESMA usada pela reprojeção automática das
    // séries por média após um "Lançar" (sem duplicar regra entre tela/hook).
    const { gas: gasHistorico, agua: aguaHistorico } = extrairHistoricosVariaveis(data ?? [])
    return {
      gas: projetarValorVariavel({ historico: gasHistorico }),
      agua: projetarValorVariavel({ historico: aguaHistorico }),
    }
  }

  // Variáveis numéricas para a pré-visualização.
  const gasNum = Number.isFinite(lerValor(gas)) ? lerValor(gas) : 0
  const aguaNum = Number.isFinite(lerValor(agua)) ? lerValor(agua) : 0

  // calcularValor = itens fixos vigentes + variáveis (função pura existente).
  const calcularValor = useCallback(
    (mes) => calcularTotalCondominio({ itens: itensVigentes, mes, gas: gasNum, agua: aguaNum }),
    [itensVigentes, gasNum, aguaNum],
  )

  // Cadastro de item fixo via ModalNovoItemFixo: delega ao criarItem do hook
  // (única implementação de vigência) e recarrega os itens vigentes do mês.
  async function aoCadastrarItem(payload) {
    await criarItem(payload)
    const ultimo = ultimoDia(mesAno)
    listar(ultimo).then(setItensVigentes).catch(() => {})
  }

  return (
    <section>
      <div style={estilos.cabecalhoLinha}>
        <p style={{ ...estilosComuns.mensagem, margin: 0 }}>
          Gera a previsão mensal de condomínio somando os itens fixos vigentes + consumo de gás/água.
        </p>
        <button type="button" onClick={() => setMostrandoItem(true)} style={estilosComuns.botaoCriar}>
          + Novo item fixo
        </button>
      </div>

      {/* Formulário reutilizável: mês/ano, vencimento, variáveis, total, gerar.
          onChange do mês é repassado via setMesAno para filtrar a vigência. */}
      <div style={{ marginTop: '1rem' }}>
        <GeradorRecorrenciaMensal
          nome="Condomínio"
          tipoOp="Saida"
          contaPadrao={contaId || undefined}
          categoriaPadrao="Condominio"
          calcularValor={calcularValor}
          aoCriarSerie={aoCriarSerie}
          aoCriar={aoCriar}
          aoPosMutacao={aoPosMutacao}
          aoResetarCamposExtra={() => {
            setGas('')
            setAgua('')
            setContaId('')
          }}
        >
          <label style={estilos.rotuloCampo}>
            Consumo de Gás (R$)
            <input style={estilosComuns.input} type="text" inputMode="decimal" placeholder="0,00" value={gas} onChange={(e) => setGas(e.target.value)} />
          </label>
          <label style={estilos.rotuloCampo}>
            Consumo de Água (R$)
            <input style={estilosComuns.input} type="text" inputMode="decimal" placeholder="0,00" value={agua} onChange={(e) => setAgua(e.target.value)} />
          </label>
          <label style={{ ...estilos.rotuloCampo, gridColumn: '1 / -1' }}>
            Conta de destino
            <select style={estilosComuns.input} value={contaId} onChange={(e) => setContaId(e.target.value)}>
              <option value="">Sem conta específica</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
        </GeradorRecorrenciaMensal>
      </div>

      {/* Consumo real (REMOVIDO em 13/09/2026): o bloco que vivia aqui migrou
          para o contexto da OCORRÊNCIA prevista de Condomínio (ação "Inserir
          consumo real" no acordeão) — evita dois lugares fazendo a mesma coisa. */}

      {/* Itens fixos vigentes no mês */}
      <div style={{ marginTop: '1.25rem' }}>
        <h3 style={estilos.subtitulo}>Itens fixos vigentes em {rotuloMes}</h3>
        {carregandoItens && <p style={estilosComuns.mensagem}>Carregando itens...</p>}
        {!carregandoItens && erroItens && <p style={estilosComuns.mensagemErro}>{erroItens}</p>}
        {!carregandoItens && !erroItens && itensVigentes.length === 0 && (
          <p style={estilosComuns.mensagem}>Nenhum item fixo vigente neste mês (cadastre acima).</p>
        )}
        {!carregandoItens && itensVigentes.length > 0 && (
          <ul style={estilos.lista}>
            {itensVigentes.map((item) => (
              <li key={item.id} style={estilos.item}>
                <span style={estilos.itemCod}>{item.cod}</span>
                <span style={estilos.itemDesc}>{item.descricao}</span>
                <span style={estilos.itemValor}>{`R$ ${Number(item.valor).toFixed(2)}`}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Modal: novo item fixo (nova vigência — nunca sobrescreve histórico).
          Componente compartilhado com o form de consumo real da ocorrência.
          A lógica de fechar a vigência anterior vive SÓ no criarItem do hook. */}
      {mostrandoItem && (
        <ModalNovoItemFixo aoCadastrar={aoCadastrarItem} aoFechar={() => setMostrandoItem(false)} />
      )}

      <p style={{ marginTop: '0.75rem', color: '#9ca3af', fontSize: '0.85rem' }}>
        A previsão aparece em "Lançamentos" com estado previsto — use o botão "Lançar" para efetivá-la em conta ou cartão.
      </p>
    </section>
  )
}

// Último dia de um mês 'YYYY-MM' como 'YYYY-MM-DD' (para filtrar vigência).
function ultimoDia(mesAno) {
  const [a, m] = mesAno.split('-').map(Number)
  const ultimo = new Date(a, m, 0).getDate()
  return `${a}-${String(m).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`
}

const estilos = {
  cabecalhoLinha: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' },
  grade: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' },
  rotuloCampo: { display: 'flex', flexDirection: 'column', gap: '0.25rem', color: '#9ca3af', fontSize: '0.8rem' },
  subtitulo: { margin: '0 0 0.5rem', fontSize: '1rem', color: '#e5e7eb' },
  lista: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  item: { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0.8rem', borderRadius: '8px', background: '#111827', border: '1px solid #1f2937' },
  itemCod: { color: '#9ca3af', fontSize: '0.85rem', minWidth: '3.2rem' },
  itemDesc: { color: '#e5e7eb', flex: 1 },
  itemValor: { color: '#f87171', fontWeight: 'bold', whiteSpace: 'nowrap' },
}
