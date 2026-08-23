// Utilitários compartilhados entre as páginas autenticadas.
// Os valores aqui são IDÊNTICOS aos que o Dashboard usava inline na
// Etapa 04 — esta extração não muda nenhum visual nem comportamento;
// existe apenas para que as páginas novas não dupliquem os mesmos
// blocos de estilos e formatadores.

// Formata 1500.5 como "R$ 1.500,50".
export const formatoReal = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

// "2026-08-18" vira "18/08/2026" na tela.
export function formatarData(dataISO) {
  const [ano, mes, dia] = dataISO.split('-')
  return `${dia}/${mes}/${ano}`
}

// Data civil LOCAL ("YYYY-MM-DD") de um Date, montada por componentes
// locais. NUNCA usar toISOString() para data civil financeira: ele converte
// para UTC e desloca o dia (no UTC−3, entre 21h e meia-noite devolveria o
// dia SEGUINTE). Serve para filtros de período e default de formulários.
export function dataCivil(data) {
  const ano = data.getFullYear()
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  const dia = String(data.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

// Data de hoje no formato que o input type="date" entende (YYYY-MM-DD),
// no fuso do aparelho (civil), não em UTC.
export function hoje() {
  return dataCivil(new Date())
}

// Estilos compartilhados pelas páginas autenticadas.
export const estilosComuns = {
  conteudo: {
    padding: '1.25rem 1.5rem 3.5rem',
    maxWidth: '720px',
    margin: '0 auto',
  },
  secao: { marginBottom: '1.25rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '340px' },
  // Grade do formulário de lançamento: campos lado a lado em 2 colunas
  // em vez de uma pilha vertical longa (a página não rola, então o
  // formulário precisa ser compacto — senão o botão fica fora da tela).
  formGrade: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.6rem',
  },
  formGradeCheio: { gridColumn: '1 / -1' },
  input: {
    padding: '0.6rem 0.8rem',
    borderRadius: '8px',
    border: '1px solid #374151',
    background: '#111827',
    color: '#e5e7eb',
    width: '100%',
    boxSizing: 'border-box',
  },
  botaoCriar: {
    padding: '0.6rem',
    borderRadius: '8px',
    border: 'none',
    background: '#42A5F5',
    color: '#0b0f19',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  mensagem: { color: '#9ca3af' },
  erro: { color: '#ef4444' },
  mensagemOk: { color: '#4ade80' },
  mensagemErro: { color: '#ef4444' },
  link: { color: '#42A5F5', textDecoration: 'none' },
  lista: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
    // Área de texto longo: a página não rola — quem rola é a própria
    // lista quando passa do limite (ex.: muitas movimentações).
    maxHeight: '30vh',
    overflowY: 'auto',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.9rem 1.1rem',
    borderRadius: '10px',
    background: '#111827',
    border: '1px solid #1f2937',
  },
  nomeConta: { fontWeight: 'bold' },
  tipoConta: { color: '#9ca3af', marginLeft: '0.6rem', fontSize: '0.85rem' },
  saldo: { fontWeight: 'bold', color: '#42A5F5' },
  valorEntrada: { fontWeight: 'bold', color: '#4ade80' },
  valorSaida: { fontWeight: 'bold', color: '#f87171' },
}