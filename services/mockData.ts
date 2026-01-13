import { Bank, Category, CategoryType, Transaction, TransactionType, Forecast } from '../types';

export const INITIAL_BANKS: Bank[] = [
  { id: 1, name: 'Nubank', accountNumber: '1234-5', nickname: 'Principal', logo: '/logo/nubank.jpg', active: false, balance: 0 },
  { id: 2, name: 'Itaú', accountNumber: '9876-0', nickname: 'Reserva', logo: '/logo/itau.png', active: false, balance: 0 },
  { id: 3, name: 'Bradesco', accountNumber: '1111-2', nickname: 'PJ', logo: '/logo/bradesco.jpg', active: false, balance: 0 },
  { id: 4, name: 'Caixa Econômica', accountNumber: '0001-9', nickname: 'Caixa', logo: '/logo/caixa.png', active: false, balance: 0 },
  { id: 5, name: 'Banco do Brasil', accountNumber: '4455-6', nickname: 'BB', logo: '/logo/bb.png', active: false, balance: 0 },
  { id: 6, name: 'Santander', accountNumber: '7788-9', nickname: 'Santander', logo: '/logo/santander.png', active: false, balance: 0 },
  { id: 7, name: 'Inter', accountNumber: '3322-1', nickname: 'Inter', logo: '/logo/inter.png', active: false, balance: 0 },
  { id: 8, name: 'BTG Pactual', accountNumber: '5566-7', nickname: 'Investimentos', logo: '/logo/btg_pactual.png', active: false, balance: 0 },
  { id: 9, name: 'C6 Bank', accountNumber: '9988-7', nickname: 'C6', logo: '/logo/c6_bank.png', active: false, balance: 0 },
  { id: 10, name: 'Sicredi', accountNumber: '1212-3', nickname: 'Cooperativa', logo: '/logo/sicredi.png', active: false, balance: 0 },
  { id: 11, name: 'Sicoob', accountNumber: '3434-5', nickname: 'Sicoob', logo: '/logo/sicoob.png', active: false, balance: 0 },
  { id: 12, name: 'Mercado Pago', accountNumber: '0000-0', nickname: 'Vendas', logo: '/logo/mercado_pago.png', active: false, balance: 0 },
  { id: 13, name: 'PagBank', accountNumber: '0000-0', nickname: 'Maquininha', logo: '/logo/pagbank.png', active: false, balance: 0 },
  { id: 14, name: 'Stone', accountNumber: '0000-0', nickname: 'Stone', logo: '/logo/stone.png', active: false, balance: 0 },
  { id: 15, name: 'Banco Safra', accountNumber: '0000-0', nickname: 'Safra', logo: '/logo/safra.png', active: false, balance: 0 },
  { id: 16, name: 'Banco Pan', accountNumber: '0000-0', nickname: 'Pan', logo: '/logo/banco_pan.png', active: false, balance: 0 },
  { id: 17, name: 'Banrisul', accountNumber: '0000-0', nickname: 'Sul', logo: '/logo/banrisul.png', active: false, balance: 0 },
  { id: 18, name: 'Neon', accountNumber: '0000-0', nickname: 'Neon', logo: '/logo/neon.png', active: false, balance: 0 },
  { id: 19, name: 'Caixa Registradora', accountNumber: '-', nickname: 'Dinheiro Físico', logo: '/logo/caixaf.png', active: false, balance: 0 },
];

// Updated to match server.js INITIAL_CATEGORIES_SEED
export const INITIAL_CATEGORIES: Category[] = [
    // RECEITAS
    { id: 1, name: 'Vendas de Mercadorias', type: CategoryType.INCOME, groupType: 'receita_bruta' },
    { id: 2, name: 'Prestação de Serviços', type: CategoryType.INCOME, groupType: 'receita_bruta' },
    { id: 3, name: 'Receita de Aluguel', type: CategoryType.INCOME, groupType: 'outras_receitas' },
    { id: 4, name: 'Comissões Recebidas', type: CategoryType.INCOME, groupType: 'receita_bruta' },
    { id: 5, name: 'Receita Financeira', type: CategoryType.INCOME, groupType: 'receita_financeira' },
    { id: 6, name: 'Devoluções de Despesas', type: CategoryType.INCOME, groupType: 'receita_financeira' },
    { id: 7, name: 'Reembolsos de Clientes', type: CategoryType.INCOME, groupType: 'outras_receitas' },
    { id: 8, name: 'Transferências Internas', type: CategoryType.INCOME, groupType: 'nao_operacional' },
    { id: 9, name: 'Aportes de Sócios / Investimentos', type: CategoryType.INCOME, groupType: 'nao_operacional' },
    { id: 10, name: 'Outras Receitas Operacionais', type: CategoryType.INCOME, groupType: 'outras_receitas' },
    { id: 11, name: 'Venda de Ativo Imobilizado', type: CategoryType.INCOME, groupType: 'receita_nao_operacional' },
    
    // DESPESAS
    { id: 12, name: 'Compra de Mercadorias', type: CategoryType.EXPENSE, groupType: 'cmv' },
    { id: 13, name: 'Matéria-Prima', type: CategoryType.EXPENSE, groupType: 'cmv' },
    { id: 14, name: 'Fretes sobre Compras', type: CategoryType.EXPENSE, groupType: 'cmv' },
    { id: 15, name: 'Embalagens', type: CategoryType.EXPENSE, groupType: 'cmv' },
    { id: 16, name: 'Salários e Ordenados', type: CategoryType.EXPENSE, groupType: 'despesa_pessoal' },
    { id: 17, name: 'Pró-Labore', type: CategoryType.EXPENSE, groupType: 'despesa_pessoal' },
    { id: 18, name: 'Vale Transporte / Alimentação', type: CategoryType.EXPENSE, groupType: 'despesa_pessoal' },
    { id: 19, name: 'Encargos Sociais (FGTS/INSS)', type: CategoryType.EXPENSE, groupType: 'despesa_pessoal' },
    { id: 20, name: 'Aluguel e Condomínio', type: CategoryType.EXPENSE, groupType: 'despesa_administrativa' },
    { id: 21, name: 'Energia / Água / Telefone', type: CategoryType.EXPENSE, groupType: 'despesa_administrativa' },
    { id: 22, name: 'Internet e Sistemas', type: CategoryType.EXPENSE, groupType: 'despesa_administrativa' },
    { id: 23, name: 'Material de Escritório/Limpeza', type: CategoryType.EXPENSE, groupType: 'despesa_administrativa' },
    { id: 24, name: 'Contabilidade e Jurídico', type: CategoryType.EXPENSE, groupType: 'despesa_administrativa' },
    { id: 25, name: 'Marketing e Publicidade', type: CategoryType.EXPENSE, groupType: 'despesa_operacional' },
    { id: 26, name: 'Comissões de Vendas', type: CategoryType.EXPENSE, groupType: 'despesa_operacional' },
    { id: 27, name: 'Combustível e Viagens', type: CategoryType.EXPENSE, groupType: 'despesa_operacional' },
    { id: 28, name: 'DAS - Simples Nacional', type: CategoryType.EXPENSE, groupType: 'impostos' },
    { id: 29, name: 'ICMS / ISS a Recolher', type: CategoryType.EXPENSE, groupType: 'impostos' },
    { id: 30, name: 'Taxas e Alvarás', type: CategoryType.EXPENSE, groupType: 'impostos' },
    { id: 31, name: 'Tarifas Bancárias', type: CategoryType.EXPENSE, groupType: 'despesa_financeira' },
    { id: 32, name: 'Juros Pagos', type: CategoryType.EXPENSE, groupType: 'despesa_financeira' },
    { id: 33, name: 'Antecipação de Recebíveis', type: CategoryType.EXPENSE, groupType: 'despesa_financeira' },
    { id: 34, name: 'Distribuição de Lucros', type: CategoryType.EXPENSE, groupType: 'nao_operacional' },
    { id: 35, name: 'Empréstimos (Pagamento Principal)', type: CategoryType.EXPENSE, groupType: 'nao_operacional' },
    { id: 36, name: 'Transferência entre Contas', type: CategoryType.EXPENSE, groupType: 'nao_operacional' }
];

export const INITIAL_TRANSACTIONS: Transaction[] = [];
export const INITIAL_FORECASTS: Forecast[] = [];