export enum TransactionType {
  CREDIT = 'credito',
  DEBIT = 'debito'
}

export enum CategoryType {
  INCOME = 'receita',
  EXPENSE = 'despesa'
}

export interface Bank {
  id: number;
  name: string;
  accountNumber: string;
  nickname?: string;
  logo: string;
  active: boolean;
  balance: number;
}

export interface Category {
  id: number;
  name: string;
  type: CategoryType;
}

export interface KeywordRule {
  id: number;
  keyword: string;
  type: TransactionType;
  categoryId: number;
  bankId?: number | null; // Adicionado para vincular a banco específico
}

export interface OFXImport {
  id: number;
  fileName: string;
  importDate: string;
  bankId: number;
  transactionCount: number;
}

export interface Transaction {
  id: number;
  date: string; // ISO Date YYYY-MM-DD
  description: string;
  summary?: string;
  type: TransactionType;
  value: number;
  categoryId?: number;
  bankId: number;
  reconciled: boolean;
  ofxImportId?: number | null; // Link to the OFX file
}

export interface Forecast {
  id: number;
  date: string;
  description: string;
  value: number;
  type: TransactionType;
  bankId: number;
  categoryId: number;
  realized: boolean; // Se já foi efetivado virou transação ou não
  installmentCurrent?: number;
  installmentTotal?: number;
  groupId?: string; // Para identificar parcelas do mesmo grupo
}

export interface DashboardStats {
  totalBalance: number;
  totalIncome: number;
  totalExpense: number;
  reconciledCount: number;
  pendingCount: number;
}