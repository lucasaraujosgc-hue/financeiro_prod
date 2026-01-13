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

// Updated to match server.js INITIAL_CATEGORIES_SEED (Clean List)
export const INITIAL_CATEGORIES: Category[] = [
    // RECEITAS
    { id: 1, name: 'Vendas de Mercadorias', type: CategoryType.INCOME, groupType: 'receita_bruta' },
    { id: 2, name: 'Prestação de Serviços', type: CategoryType.INCOME, groupType: 'receita_bruta' },
    { id: 3, name: 'Receita de Aluguel', type: CategoryType.INCOME, groupType: 'outras_receitas' },
    { id: 4, name: 'Comissões Recebidas', type: CategoryType.INCOME, groupType: 'receita_bruta' },
    { id: 5, name: 'Receita Financeira (juros, rendimentos)', type: CategoryType.INCOME, groupType: 'receita_financeira' },
    { id: 6, name: 'Devoluções de Despesas', type: CategoryType.INCOME, groupType: 'receita_financeira' },
    { id: 7, name: 'Reembolsos de Clientes', type: CategoryType.INCOME, groupType: 'outras_receitas' },
    { id: 8, name: 'Aportes de Sócios / Investimentos', type: CategoryType.INCOME, groupType: 'nao_operacional' },
    { id: 9, name: 'Outras Receitas Operacionais', type: CategoryType.INCOME, groupType: 'outras_receitas' },
    { id: 10, name: 'Receitas Não Operacionais (venda de ativo)', type: CategoryType.INCOME, groupType: 'receita_nao_operacional' },
    
    // DESPESAS
    { id: 11, name: 'Compra de Mercadorias / Matéria-Prima', type: CategoryType.EXPENSE, groupType: 'cmv' },
    { id: 12, name: 'Fretes e Transportes', type: CategoryType.EXPENSE, groupType: 'cmv' },
    { id: 13, name: 'Custos Diretos', type: CategoryType.EXPENSE, groupType: 'cmv' },
    { id: 14, name: 'Despesas com Pessoal (salários, pró-labore)', type: CategoryType.EXPENSE, groupType: 'despesa_pessoal' },
    { id: 15, name: 'Serviços de Terceiros (contabilidade, marketing)', type: CategoryType.EXPENSE, groupType: 'despesa_operacional' },
    { id: 16, name: 'Despesas Administrativas (papelaria, escritório)', type: CategoryType.EXPENSE, groupType: 'despesa_administrativa' },
    { id: 17, name: 'Despesas Comerciais (comissões, propaganda)', type: CategoryType.EXPENSE, groupType: 'despesa_operacional' },
    { id: 18, name: 'Energia Elétrica / Água / Telefone / Internet', type: CategoryType.EXPENSE, groupType: 'despesa_administrativa' },
    { id: 19, name: 'Aluguel e Condomínio', type: CategoryType.EXPENSE, groupType: 'despesa_administrativa' },
    { id: 20, name: 'Manutenção e Limpeza', type: CategoryType.EXPENSE, groupType: 'despesa_administrativa' },
    { id: 21, name: 'Combustível e Deslocamento', type: CategoryType.EXPENSE, groupType: 'despesa_operacional' },
    { id: 22, name: 'Seguros', type: CategoryType.EXPENSE, groupType: 'despesa_administrativa' },
    { id: 23, name: 'Impostos e Taxas (ISS, ICMS, DAS)', type: CategoryType.EXPENSE, groupType: 'impostos' },
    { id: 24, name: 'Despesas Financeiras (juros, multas)', type: CategoryType.EXPENSE, groupType: 'despesa_financeira' },
    { id: 25, name: 'Transferências Internas (entre contas)', type: CategoryType.EXPENSE, groupType: 'nao_operacional' },
    { id: 26, name: 'Distribuição de Lucros / Retirada', type: CategoryType.EXPENSE, groupType: 'nao_operacional' },
    { id: 27, name: 'Outras Despesas Operacionais', type: CategoryType.EXPENSE, groupType: 'despesa_operacional' },
    { id: 28, name: 'Despesas Não Operacionais (baixas contábeis)', type: CategoryType.EXPENSE, groupType: 'despesa_nao_operacional' }
];

export const INITIAL_TRANSACTIONS: Transaction[] = [];
export const INITIAL_FORECASTS: Forecast[] = [];