const MAIS_USADAS_EM_ORDEM = [
  'Supermercado',
  'Transferência',
  'Restaurante e Delivery',
  'Diva',
  'Padaria e Confeitaria',
]

const comparadorBr = new Intl.Collator('pt-BR', { sensitivity: 'base' })

const GRUPOS_BRUTOS = [
  {
    nome: 'Entradas',
    categorias: ['Salário e Depósitos', 'Transferência', 'Diva', 'Caixinha'],
  },
  {
    nome: 'Alimentação',
    categorias: [
      'Supermercado',
      'Padaria e Confeitaria',
      'Restaurante e Delivery',
      'Feira e Direto do Produtor',
      'Açougue',
    ],
  },
  {
    nome: 'Transporte',
    categorias: [
      'Transporte (combustível)',
      'Transporte (estacionamento)',
      'Manutenção de Veículo',
      'Seguro de Veículo',
    ],
  },
  {
    nome: 'Casa',
    categorias: [
      'Moradia e Contas Fixas',
      'Manutenção de Casa',
      'Energia',
      'Casa e Utensílios',
      'Condominio',
    ],
  },
  {
    nome: 'Pessoal',
    categorias: ['Saúde e Farmácia', 'Beleza', 'Moda e Vestuário', 'Eletrônicos e Acessórios'],
  },
  {
    nome: 'Outros gastos',
    categorias: [
      'Assinaturas',
      'Compras Online',
      'Presentes',
      'Doação',
      'Viagem',
      'Entretenimento',
      'Papelaria',
      'Impostos e Taxas',
      'Juros e Multas',
      'Fatura Cartão',
      'Diva',
      'Transferência',
      'AnPerez',
      'Outros',
    ],
  },
]

// Dentro de cada grupo, as categorias mais usadas vêm primeiro (na ordem da
// lista MAIS_USADAS_EM_ORDEM) e o restante em ordem alfabética pt-BR.
export const GRUPOS_CATEGORIAS = GRUPOS_BRUTOS.map((grupo) => {
  const noTopo = MAIS_USADAS_EM_ORDEM.filter((c) => grupo.categorias.includes(c))
  const demais = grupo.categorias
    .filter((c) => !noTopo.includes(c))
    .sort(comparadorBr.compare)
  return { nome: grupo.nome, categorias: [...noTopo, ...demais] }
})

export function categoriaExiste(nome) {
  return GRUPOS_CATEGORIAS.some((grupo) => grupo.categorias.includes(nome))
}