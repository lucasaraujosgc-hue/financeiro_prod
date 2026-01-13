import React, { useState, useEffect, useMemo } from 'react';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import Transactions from './components/Transactions';
import BankList from './components/BankList';
import Reports from './components/Reports';
import Login from './components/Login';
import ForgotPassword from './components/ForgotPassword';
import SignUp from './components/SignUp';
import ResetPassword from './components/ResetPassword';
import FinalizeSignUp from './components/FinalizeSignUp';
import Forecasts from './components/Forecasts';
import OFXImports from './components/OFXImports';
import Categories from './components/Categories';
import KeywordRules from './components/KeywordRules';
import Tutorial from './components/Tutorial';
import AdminPanel from './components/AdminPanel'; 
import { Transaction, Bank, Category, Forecast, KeywordRule } from './types';
import { AlertTriangle, RefreshCcw } from 'lucide-react';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<any>(null); 
  const [token, setToken] = useState<string | null>(null);
  const [authView, setAuthView] = useState<'login' | 'forgot' | 'signup' | 'reset' | 'finalize'>('login');
  const [urlToken, setUrlToken] = useState<string | null>(null); 
  const [isLoading, setIsLoading] = useState(false);
  const [isAppError, setIsAppError] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  
  const [banks, setBanks] = useState<Bank[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [keywordRules, setKeywordRules] = useState<KeywordRule[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    const tokenParam = params.get('token');

    if (action && tokenParam) {
        setUrlToken(tokenParam);
        if (action === 'finalize') setAuthView('finalize');
        else if (action === 'reset') setAuthView('reset');
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        const savedToken = localStorage.getItem('finance_app_token');
        const savedUser = localStorage.getItem('finance_app_user');
        if (savedToken && savedUser) {
            try {
                setToken(savedToken);
                setUser(JSON.parse(savedUser));
                setIsAuthenticated(true);
            } catch (e) {
                localStorage.removeItem('finance_app_token');
            }
        }
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && token && user?.role !== 'admin') {
        fetchInitialData();
    }
  }, [isAuthenticated, token, user]);

  // CÁLCULO DE SALDO DINÂMICO (CORREÇÃO DE SALDO ATUAL)
  // Calcula o saldo de cada banco com base nas transações carregadas
  const banksWithBalance = useMemo(() => {
      return banks.map(bank => {
          const bankTxs = transactions.filter(t => t.bankId === bank.id);
          // Calcula saldo com base em TODAS as transações (não apenas conciliadas, conforme padrão usual de "Book Balance")
          // Se quiser apenas conciliadas, adicione && t.reconciled no filter acima
          const balance = bankTxs.reduce((acc, t) => {
              const val = Math.abs(t.value);
              // Verifica string de tipo para ser robusto
              const isCredit = t.type === 'credito' || String(t.type).toLowerCase().includes('receita');
              return isCredit ? acc + val : acc - val;
          }, 0);
          
          return { ...bank, balance };
      });
  }, [banks, transactions]);

  // JWT Helper
  const apiFetch = async (url: string, options: RequestInit = {}) => {
      const storedToken = localStorage.getItem('finance_app_token');
      const headers = { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${storedToken}`,
          ...options.headers 
      };
      const res = await fetch(url, { ...options, headers });
      if (res.status === 401 || res.status === 403) {
          handleLogout();
          throw new Error("Sessão expirada");
      }
      return res;
  };

  const fetchInitialData = async () => {
      setIsAppError(false);
      try {
          await Promise.all([
              fetchBanks(),
              fetchCategories(),
              fetchTransactions(),
              fetchForecasts(),
              fetchKeywordRules()
          ]);
      } catch (e) {
          console.error("Erro ao carregar dados", e);
          setIsAppError(true);
      }
  };

  const fetchBanks = async () => {
      const res = await apiFetch('/api/banks');
      if (res.ok) setBanks(await res.json());
  };
  const fetchCategories = async () => {
      const res = await apiFetch('/api/categories');
      if (res.ok) setCategories(await res.json());
  };
  const fetchTransactions = async () => {
      const res = await apiFetch('/api/transactions');
      if (res.ok) setTransactions(await res.json());
  };
  const fetchForecasts = async () => {
      const res = await apiFetch('/api/forecasts');
      if (res.ok) setForecasts(await res.json());
  };
  const fetchKeywordRules = async () => {
      const res = await apiFetch('/api/keyword-rules');
      if (res.ok) setKeywordRules(await res.json());
  };

  const handleAddCategory = async (cat: any) => {
      const res = await apiFetch('/api/categories', { method: 'POST', body: JSON.stringify(cat) });
      if(res.ok) fetchCategories();
  };
  const handleDeleteCategory = async (id: number) => {
      if(confirm('Excluir?')) { await apiFetch(`/api/categories/${id}`, { method: 'DELETE' }); fetchCategories(); }
  };
  const handleAddTransaction = async (tx: any) => {
      const res = await apiFetch('/api/transactions', { method: 'POST', body: JSON.stringify(tx) });
      if(res.ok) fetchTransactions();
  };
  const handleEditTransaction = async (id: number, tx: any) => {
      const res = await apiFetch(`/api/transactions/${id}`, { method: 'PUT', body: JSON.stringify(tx) });
      if(res.ok) fetchTransactions();
  };
  const handleDeleteTransaction = async (id: number) => {
      if(confirm('Excluir?')) { await apiFetch(`/api/transactions/${id}`, { method: 'DELETE' }); fetchTransactions(); }
  };
  const handleReconcile = async (id: number) => {
      const tx = transactions.find(t => t.id === id);
      if(tx) { await apiFetch(`/api/transactions/${id}/reconcile`, { method: 'PATCH', body: JSON.stringify({reconciled: !tx.reconciled}) }); fetchTransactions(); }
  };
  const handleBatchUpdateTransaction = async (ids: number[], catId: number) => {
      await apiFetch('/api/transactions/batch-update', { method: 'PATCH', body: JSON.stringify({transactionIds: ids, categoryId: catId}) }); fetchTransactions();
  };
  const handleUpdateBank = async (b: any) => {
      await apiFetch(`/api/banks/${b.id}`, { method: 'PUT', body: JSON.stringify(b) }); fetchBanks();
  };
  const handleAddBank = async (b: any) => {
      const res = await apiFetch('/api/banks', { method: 'POST', body: JSON.stringify(b) }); if(res.ok) fetchBanks();
  };
  const handleDeleteBank = async (id: number) => {
      await apiFetch(`/api/banks/${id}`, { method: 'DELETE' }); fetchBanks();
  };
  const handleAddKeywordRule = async (r: any) => {
      const res = await apiFetch('/api/keyword-rules', { method: 'POST', body: JSON.stringify(r) }); if(res.ok) fetchKeywordRules();
  };
  const handleDeleteKeywordRule = async (id: number) => {
      await apiFetch(`/api/keyword-rules/${id}`, { method: 'DELETE' }); fetchKeywordRules();
  };

  const handleLogout = () => {
      setIsAuthenticated(false);
      setUser(null);
      setToken(null);
      localStorage.removeItem('finance_app_token');
      localStorage.removeItem('finance_app_user');
      setAuthView('login');
  };

  const handleLogin = async (data: any, rememberMe: boolean) => {
    setIsLoading(true);
    try {
        const res = await fetch('/api/login', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
        if (res.ok) {
            const responseData = await res.json();
            setUser(responseData.user);
            setToken(responseData.token);
            setIsAuthenticated(true);
            if (rememberMe) {
                localStorage.setItem('finance_app_token', responseData.token);
                localStorage.setItem('finance_app_user', JSON.stringify(responseData.user));
            }
        } else {
            const err = await res.json();
            alert(err.error || "Erro no login");
        }
    } catch (e) { alert("Erro de conexão"); } finally { setIsLoading(false); }
  };

  const handleForgotPassword = async (email: string) => {
      const res = await fetch('/api/recover-password', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ email }) });
      if (!res.ok) throw new Error("Erro ao recuperar senha");
  };

  if (isAppError) {
      return (
          <div className="flex flex-col items-center justify-center h-screen bg-slate-950 text-white p-4 text-center">
              <AlertTriangle className="text-red-500 w-12 h-12 mb-4" />
              <h2 className="text-2xl font-bold mb-2">Serviço Indisponível</h2>
              <button onClick={fetchInitialData} className="flex items-center gap-2 bg-primary px-6 py-2 rounded-lg text-slate-900 font-bold hover:bg-emerald-400 mt-4"><RefreshCcw size={18} /> Tentar Novamente</button>
          </div>
      );
  }

  if (!isAuthenticated) {
    if (authView === 'forgot') return <ForgotPassword onBack={() => setAuthView('login')} onSubmit={handleForgotPassword} />;
    if (authView === 'signup') return <SignUp onBack={() => setAuthView('login')} isLoading={isLoading} />;
    if (authView === 'finalize') return <FinalizeSignUp token={urlToken || ''} onSuccess={() => { setAuthView('login'); setUrlToken(null); }} />;
    if (authView === 'reset') return <ResetPassword token={urlToken || ''} onSuccess={() => setAuthView('login')} />;
    return <Login onLogin={handleLogin} onForgotPassword={() => setAuthView('forgot')} onSignUp={() => setAuthView('signup')} isLoading={isLoading} />;
  }

  if (user?.role === 'admin') return <AdminPanel onLogout={handleLogout} />;

  // Filtrar bancos ativos para a UI principal (BankList receberá todos para poder gerenciar arquivados)
  // Mas BankList usa a prop "banks" que agora deve ser "banksWithBalance" para mostrar o saldo correto
  const activeBanks = banksWithBalance.filter(b => b.active);

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard userId={user.id} transactions={transactions} banks={activeBanks} forecasts={forecasts} categories={categories} onRefresh={fetchInitialData} />;
      case 'transactions': return <Transactions userId={user.id} transactions={transactions} banks={activeBanks} categories={categories} onAddTransaction={handleAddTransaction} onEditTransaction={handleEditTransaction} onDeleteTransaction={handleDeleteTransaction} onReconcile={handleReconcile} onBatchUpdate={handleBatchUpdateTransaction} />;
      case 'import': return <OFXImports userId={user.id} banks={activeBanks} keywordRules={keywordRules} transactions={transactions} onTransactionsImported={fetchInitialData} />;
      case 'rules': return <KeywordRules categories={categories} rules={keywordRules} banks={activeBanks} onAddRule={handleAddKeywordRule} onDeleteRule={handleDeleteKeywordRule} />;
      case 'banks': return <BankList banks={banksWithBalance} onUpdateBank={handleUpdateBank} onAddBank={handleAddBank} onDeleteBank={handleDeleteBank} />;
      case 'categories': return <Categories categories={categories} onAddCategory={handleAddCategory} onDeleteCategory={handleDeleteCategory} />;
      case 'reports': return <Reports transactions={transactions} categories={categories} />;
      case 'forecasts': return <Forecasts userId={user.id} banks={activeBanks} categories={categories} onUpdate={fetchInitialData} />;
      case 'tutorial': return <Tutorial />;
      default: return <Dashboard userId={user.id} transactions={transactions} banks={activeBanks} forecasts={forecasts} categories={categories} onRefresh={fetchInitialData} />;
    }
  };

  return <Layout activeTab={activeTab} onTabChange={setActiveTab} onLogout={handleLogout} userName={user?.razaoSocial}>{renderContent()}</Layout>;
}

export default App;