import React, { useState } from 'react';
import { Transaction, TransactionType, Bank, Forecast, Category, CategoryType } from '../types';
import { ArrowUpCircle, ArrowDownCircle, Wallet, AlertCircle, CheckCircle2, TrendingUp, TrendingDown, Plus, Minus, X, ThumbsUp, ThumbsDown, Repeat, CalendarDays, AlertTriangle, CalendarClock, Check, Trash2, ChevronLeft, ChevronRight, Calculator, Calendar, ShieldCheck } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface DashboardProps {
  token: string;
  userId: number;
  transactions: Transaction[];
  banks: Bank[];
  forecasts: Forecast[];
  categories: Category[];
  onRefresh: () => Promise<void>;
}

const Dashboard: React.FC<DashboardProps> = ({ token, userId, transactions, banks, forecasts, categories, onRefresh }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isOverdueModalOpen, setIsOverdueModalOpen] = useState(false);
  
  const [selectedBankForForecasts, setSelectedBankForForecasts] = useState<number | null>(null);
  const [realizeModal, setRealizeModal] = useState<{ isOpen: boolean; forecast: Forecast | null; date: string }>({
      isOpen: false,
      forecast: null,
      date: ''
  });

  const [currentMonth, setCurrentMonth] = useState<number>(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState<number>(new Date().getFullYear());

  const [formData, setFormData] = useState({
      description: '',
      value: '',
      type: TransactionType.DEBIT,
      date: new Date().toISOString().split('T')[0],
      categoryId: 0,
      bankId: 0,
      installments: 1,
      isFixed: false
  });

  const startOfSelectedMonth = new Date(currentYear, currentMonth, 1);
  const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  const getHeaders = () => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
  });

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
        setCurrentMonth(11);
        setCurrentYear(currentYear - 1);
    } else {
        setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
        setCurrentMonth(0);
        setCurrentYear(currentYear + 1);
    } else {
        setCurrentMonth(currentMonth + 1);
    }
  };

  // --- Logic for Data Calculation ---

  const overdueForecasts = forecasts.filter(f => {
      const fDate = new Date(f.date);
      const fDateMidnight = new Date(fDate.getFullYear(), fDate.getMonth(), fDate.getDate());
      return fDateMidnight < startOfSelectedMonth && !f.realized;
  }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Lógica de cálculo corrigida
  const calculateProjectedBalance = (bank: Bank) => {
      // 1. Saldo Atual (Já inclui todos os lançamentos: pendentes e conciliados, pois foi calculado no App.tsx)
      let projected = bank.balance;

      // 2. Adicionar Previsões Futuras (Forecasts não realizados)
      // Considerando todas as previsões futuras cadastradas
      const bankForecasts = forecasts.filter(f => f.bankId === bank.id && !f.realized);
      bankForecasts.forEach(f => {
          const val = Math.abs(f.value);
          const isCredit = f.type === TransactionType.CREDIT;
          projected += isCredit ? val : -val;
      });

      return projected;
  };

  const currentMonthTransactions = transactions.filter(t => {
      const d = new Date(t.date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });

  const recentTransactions = [...currentMonthTransactions]
      .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5);

  const getTopCategories = (type: TransactionType) => {
      const filtered = currentMonthTransactions.filter(t => t.type === type);
      const total = filtered.reduce((acc, t) => acc + t.value, 0);
      
      const grouped = filtered.reduce((acc, t) => {
          const cat = categories.find(c => c.id === t.categoryId);
          const name = cat ? cat.name : 'Sem Categoria';
          acc[name] = (acc[name] || 0) + t.value;
          return acc;
      }, {} as Record<string, number>);

      return Object.entries(grouped)
          .map(([name, value]) => ({ 
              name, 
              value: Number(value), 
              percent: total > 0 ? (Number(value) / total) * 100 : 0 
          }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 4);
  };

  const topIncomeCategories = getTopCategories(TransactionType.CREDIT);
  const topExpenseCategories = getTopCategories(TransactionType.DEBIT);

  // Alterado: Remove o filtro de conciliado para considerar tudo
  const allTimeIncome = transactions.filter(t => t.type === TransactionType.CREDIT).reduce((acc, curr) => acc + curr.value, 0);
  const allTimeExpense = transactions.filter(t => t.type === TransactionType.DEBIT).reduce((acc, curr) => acc + curr.value, 0);
  const totalBalance = allTimeIncome - allTimeExpense;

  // No Mês
  const monthRealizedIncome = currentMonthTransactions.filter(t => t.type === TransactionType.CREDIT).reduce((acc, curr) => acc + curr.value, 0);
  const monthRealizedExpense = currentMonthTransactions.filter(t => t.type === TransactionType.DEBIT).reduce((acc, curr) => acc + curr.value, 0);

  const currentMonthForecasts = forecasts.filter(f => {
      const d = new Date(f.date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear && !f.realized;
  });

  const monthForecastIncome = currentMonthForecasts.filter(f => f.type === TransactionType.CREDIT).reduce((acc, curr) => acc + curr.value, 0);
  const monthForecastExpense = currentMonthForecasts.filter(f => f.type === TransactionType.DEBIT).reduce((acc, curr) => acc + curr.value, 0);

  const chartData = [
      { name: 'Receita', value: monthRealizedIncome },
      { name: 'Despesa', value: monthRealizedExpense },
  ];

  // --- Modal & Action Handlers ---

  const openModal = (type: TransactionType) => {
      setFormData({
          description: '',
          value: '',
          type: type,
          date: new Date().toISOString().split('T')[0],
          categoryId: 0,
          bankId: banks[0]?.id || 0,
          installments: 1,
          isFixed: false
      });
      setIsModalOpen(true);
  };

  const openRealizeModal = (forecast: Forecast) => {
      setRealizeModal({
          isOpen: true,
          forecast,
          date: forecast.date
      });
  };

  const confirmRealization = async () => {
      if (!realizeModal.forecast || !realizeModal.date) return;
      const forecast = realizeModal.forecast;
      const finalDate = realizeModal.date;

      try {
        await fetch(`/api/forecasts/${forecast.id}/realize`, { method: 'PATCH', headers: getHeaders() });
        const descSuffix = forecast.installmentTotal ? ` (${forecast.installmentCurrent}/${forecast.installmentTotal})` : (forecast.groupId ? ' (Recorrente)' : '');
        await fetch('/api/transactions', {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
                date: finalDate,
                description: forecast.description + descSuffix,
                value: forecast.value,
                type: forecast.type,
                categoryId: forecast.categoryId,
                bankId: forecast.bankId,
                reconciled: false
            })
        });
        await onRefresh();
        setRealizeModal({ isOpen: false, forecast: null, date: '' });
        if (overdueForecasts.length <= 1) setIsOverdueModalOpen(false);
      } catch (error) { alert("Erro ao efetivar previsão."); }
  };

  const handleDeleteForecast = async (id: number) => {
      if(!confirm('Excluir esta previsão pendente?')) return;
      try {
          await fetch(`/api/forecasts/${id}`, { method: 'DELETE', headers: getHeaders() });
          await onRefresh();
          if (overdueForecasts.length <= 1) setIsOverdueModalOpen(false);
      } catch (e) { alert("Erro ao excluir."); }
  };

  const handleDeleteTransaction = async (id: number) => {
      if(!confirm('Excluir este lançamento?')) return;
      try {
          await fetch(`/api/transactions/${id}`, { method: 'DELETE', headers: getHeaders() });
          await onRefresh();
      } catch (e) { alert("Erro ao excluir."); }
  };

  const handleQuickSave = async (target: 'forecast' | 'transaction') => {
      if (!formData.description || !formData.value || !formData.bankId) return alert("Preencha todos os campos obrigatórios");
      const value = Math.abs(Number(formData.value));
      const groupId = Date.now().toString();
      const baseDate = new Date(formData.date);
      const installments = formData.isFixed ? 60 : Math.max(1, Math.floor(Number(formData.installments)));

      try {
          for (let i = 0; i < installments; i++) {
              const currentDate = new Date(baseDate);
              currentDate.setMonth(baseDate.getMonth() + i);
              const dateStr = currentDate.toISOString().split('T')[0];
              const isRecurrent = installments > 1 || formData.isFixed;
              const currentInstallment = i + 1;
              
              if (target === 'transaction' && i === 0) {
                  const descSuffix = isRecurrent ? (formData.isFixed ? ' (Fixo)' : ` (${currentInstallment}/${installments})`) : '';
                  await fetch('/api/transactions', {
                       method: 'POST', headers: getHeaders(),
                       body: JSON.stringify({
                           date: dateStr, description: formData.description + descSuffix, value: value, type: formData.type,
                           categoryId: Number(formData.categoryId), bankId: Number(formData.bankId), reconciled: false
                       })
                   });
              } else {
                  await fetch('/api/forecasts', {
                      method: 'POST', headers: getHeaders(),
                      body: JSON.stringify({
                          date: dateStr, description: formData.description, value: value, type: formData.type,
                          categoryId: Number(formData.categoryId), bankId: Number(formData.bankId),
                          installmentCurrent: currentInstallment, installmentTotal: formData.isFixed ? 0 : installments,
                          groupId: isRecurrent ? groupId : null, realized: false
                      })
                  });
              }
          }
          setIsModalOpen(false);
          await onRefresh();
      } catch (error) { alert("Erro ao salvar"); }
  };

  const availableCategories = categories.filter(c => formData.type === TransactionType.CREDIT ? c.type === CategoryType.INCOME : c.type === CategoryType.EXPENSE);

  return (
    <div className="space-y-4 pb-4">
      
      {overdueForecasts.length > 0 && (
          <div onClick={() => setIsOverdueModalOpen(true)} className="bg-amber-950/40 border border-amber-500/30 p-3 rounded-xl cursor-pointer hover:bg-amber-900/40 transition-all group">
              <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-500 flex items-center justify-center border border-amber-500/30">
                          <AlertTriangle size={16} />
                      </div>
                      <div>
                          <h3 className="font-bold text-amber-400 text-sm">Pendências</h3>
                          <p className="text-xs text-amber-200/70">{overdueForecasts.length} previsões atrasadas.</p>
                      </div>
                  </div>
                  <div className="bg-amber-500 text-slate-900 px-3 py-1 rounded-lg text-xs font-bold">Resolver</div>
              </div>
          </div>
      )}

      <div className="flex flex-col md:flex-row justify-between items-end gap-3">
        <div>
            <div className="flex items-center gap-2 mb-0.5">
                 <button onClick={handlePrevMonth} className="p-1 hover:bg-slate-800 rounded text-slate-400"><ChevronLeft size={16}/></button>
                 <span className="text-white font-bold text-base capitalize">{MONTHS[currentMonth]} / {currentYear}</span>
                 <button onClick={handleNextMonth} className="p-1 hover:bg-slate-800 rounded text-slate-400"><ChevronRight size={16}/></button>
            </div>
            <p className="text-slate-400 text-xs">Visão geral do fluxo de caixa</p>
        </div>
        <div className="flex gap-2">
            <button onClick={() => openModal(TransactionType.CREDIT)} className="w-9 h-9 rounded-lg bg-primary hover:bg-primaryHover text-slate-900 flex items-center justify-center shadow-lg transition-all" title="Nova Receita"><Plus size={20} /></button>
            <button onClick={() => openModal(TransactionType.DEBIT)} className="w-9 h-9 rounded-lg bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center shadow-lg transition-all" title="Nova Despesa"><Minus size={20} /></button>
        </div>
      </div>

      {/* Top Cards (Summary) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Balance */}
        <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 relative overflow-hidden group">
            <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Wallet size={48} className="text-slate-400"/>
            </div>
            <div className="relative z-10">
                <p className="text-slate-400 text-xs font-medium mb-1">Saldo Atual</p>
                <h2 className="text-2xl font-bold text-white mb-1">R$ {totalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h2>
                <p className="text-[10px] text-slate-500">Conciliados e Pendentes</p>
            </div>
        </div>

        {/* Income */}
        <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 relative overflow-hidden group">
            <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <CheckCircle2 size={48} className="text-emerald-500"/>
            </div>
            <div className="relative z-10">
                <p className="text-emerald-500 text-xs font-medium mb-1 flex items-center gap-1"><TrendingUp size={14}/> Receitas</p>
                <h2 className="text-2xl font-bold text-emerald-400 mb-1">R$ {monthRealizedIncome.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h2>
                <p className="text-[10px] text-slate-500">Previsto: <span className="text-emerald-500/70">+ R$ {monthForecastIncome.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></p>
            </div>
        </div>

        {/* Expense */}
        <div className="bg-slate-900 rounded-xl p-4 border border-slate-800 relative overflow-hidden group">
            <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <ShieldCheck size={48} className="text-rose-500"/>
            </div>
            <div className="relative z-10">
                <p className="text-rose-500 text-xs font-medium mb-1 flex items-center gap-1"><TrendingDown size={14}/> Despesas</p>
                <h2 className="text-2xl font-bold text-rose-400 mb-1">R$ {monthRealizedExpense.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h2>
                <p className="text-[10px] text-slate-500">Previsto: <span className="text-rose-500/70">+ R$ {monthForecastExpense.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></p>
            </div>
        </div>
      </div>

      {/* Middle Row: Banks & Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        
        {/* Bank Balances - REDESIGNED */}
        <div className="bg-surface p-5 rounded-xl border border-slate-800 flex flex-col">
             <h3 className="font-bold text-white mb-4 text-xs uppercase tracking-wider text-slate-400">Saldos por Banco</h3>
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 overflow-y-auto max-h-[300px] custom-scroll pr-1">
                {banks.filter(b => b.active).map(bank => {
                    const projectedBalance = calculateProjectedBalance(bank);
                    return (
                        <div 
                            key={bank.id} 
                            onClick={() => setSelectedBankForForecasts(bank.id)}
                            className="bg-slate-950 p-4 rounded-xl border border-slate-800/60 hover:border-slate-700 transition-all cursor-pointer group shadow-sm relative overflow-hidden"
                        >
                            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none"/>
                            
                            <div className="flex items-center gap-3 mb-4 relative z-10">
                                <div className="w-10 h-10 rounded-lg bg-white p-1.5 flex items-center justify-center overflow-hidden shadow-sm">
                                    <img src={bank.logo} alt={bank.name} className="max-w-full max-h-full object-contain" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="font-bold text-slate-200 text-sm truncate">{bank.name}</h4>
                                    <p className="text-[10px] text-slate-500 truncate">{bank.nickname}</p>
                                </div>
                            </div>
                            
                            <div className="space-y-2 relative z-10">
                                <div className="flex justify-between items-end">
                                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Atual</span>
                                    <span className={`text-sm font-bold ${bank.balance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        R$ {bank.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                    </span>
                                </div>
                                <div className="w-full h-px bg-slate-800/50"></div>
                                <div className="flex justify-between items-end">
                                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Projetado</span>
                                    <span className={`text-sm font-bold ${projectedBalance >= 0 ? 'text-slate-300' : 'text-rose-300'}`}>
                                        R$ {projectedBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                    </span>
                                </div>
                            </div>
                        </div>
                    );
                })}
             </div>
        </div>

        {/* Chart */}
        <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 flex flex-col">
            <h3 className="font-bold text-white mb-4 text-xs uppercase tracking-wider text-slate-400">Receita x Despesa (Mensal)</h3>
            <div className="flex-1 w-full h-40">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="horizontal" barSize={40}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
                        <XAxis dataKey="name" tick={{fill: '#94a3b8', fontSize: 10}} axisLine={false} tickLine={false} />
                        <YAxis hide />
                        <Tooltip 
                            cursor={{fill: '#1e293b', opacity: 0.3}}
                            contentStyle={{backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', color: '#fff', fontSize: '12px'}}
                        />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                            {chartData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={index === 0 ? '#10b981' : '#ef4444'} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
      </div>

      {/* Analysis Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Income Analysis */}
          <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
              <h3 className="font-bold text-white mb-4 text-xs uppercase tracking-wider text-slate-400">Análise de Receitas</h3>
              <div className="space-y-3">
                  {topIncomeCategories.map((cat, idx) => (
                      <div key={idx}>
                          <div className="flex justify-between items-center text-xs mb-1">
                              <span className="text-slate-300 font-medium truncate max-w-[70%]">{cat.name}</span>
                              <span className="text-emerald-400 font-bold">R$ {cat.value.toFixed(2)}</span>
                          </div>
                          <div className="w-full bg-slate-800 rounded-full h-1.5">
                              <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${cat.percent}%` }}></div>
                          </div>
                      </div>
                  ))}
                  {topIncomeCategories.length === 0 && <p className="text-slate-500 text-xs italic">Sem receitas no mês.</p>}
              </div>
          </div>

          {/* Expense Analysis */}
          <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
              <h3 className="font-bold text-white mb-4 text-xs uppercase tracking-wider text-slate-400">Análise de Despesas</h3>
              <div className="space-y-3">
                  {topExpenseCategories.map((cat, idx) => (
                      <div key={idx}>
                          <div className="flex justify-between items-center text-xs mb-1">
                              <span className="text-slate-300 font-medium truncate max-w-[70%]">{cat.name}</span>
                              <span className="text-rose-400 font-bold">R$ {cat.value.toFixed(2)}</span>
                          </div>
                          <div className="w-full bg-slate-800 rounded-full h-1.5">
                              <div className="bg-rose-500 h-1.5 rounded-full" style={{ width: `${cat.percent}%` }}></div>
                          </div>
                      </div>
                  ))}
                  {topExpenseCategories.length === 0 && <p className="text-slate-500 text-xs italic">Sem despesas no mês.</p>}
              </div>
          </div>
      </div>

      {/* Detailed Transactions Table */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
              <h3 className="font-bold text-white text-xs uppercase tracking-wider text-slate-400">Últimos 5 Lançamentos - {MONTHS[currentMonth]} / {currentYear}</h3>
              <div className="flex gap-1">
                  <button onClick={handlePrevMonth} className="p-1 hover:bg-slate-800 rounded text-slate-400"><ChevronLeft size={14}/></button>
                  <button onClick={handleNextMonth} className="p-1 hover:bg-slate-800 rounded text-slate-400"><ChevronRight size={14}/></button>
              </div>
          </div>
          <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                  <thead className="bg-slate-950 text-slate-400 font-medium border-b border-slate-800">
                      <tr>
                          <th className="px-4 py-3">Data</th>
                          <th className="px-4 py-3">Descrição</th>
                          <th className="px-4 py-3">Categoria</th>
                          <th className="px-4 py-3">Banco</th>
                          <th className="px-4 py-3 text-right">Valor</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3 text-center">Ações</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                      {recentTransactions.length === 0 ? (
                          <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">Nenhum lançamento neste mês.</td></tr>
                      ) : (
                          recentTransactions.map(t => {
                              const bank = banks.find(b => b.id === t.bankId);
                              const category = categories.find(c => c.id === t.categoryId);
                              return (
                                  <tr key={t.id} className="hover:bg-slate-800/30">
                                      <td className="px-4 py-2 text-slate-400 font-mono">{new Date(t.date).toLocaleDateString('pt-BR')}</td>
                                      <td className="px-4 py-2 text-slate-200 font-medium">{t.description}</td>
                                      <td className="px-4 py-2 text-slate-400">{category?.name || '-'}</td>
                                      <td className="px-4 py-2 text-slate-400 flex items-center gap-2">
                                          {bank && <img src={bank.logo} className="w-4 h-4 rounded-full bg-white p-0.5" />}
                                          {bank?.name || 'Desconhecido'}
                                      </td>
                                      <td className={`px-4 py-2 text-right font-bold ${t.type === TransactionType.CREDIT ? 'text-emerald-500' : 'text-rose-500'}`}>
                                          {t.type === TransactionType.CREDIT ? '+' : '-'} R$ {t.value.toFixed(2)}
                                      </td>
                                      <td className="px-4 py-2">
                                          {t.reconciled ? (
                                              <span className="flex items-center gap-1 text-emerald-500 text-[10px] font-bold"><CheckCircle2 size={12}/> Conciliado</span>
                                          ) : (
                                              <span className="flex items-center gap-1 text-slate-500 text-[10px] font-bold"><CheckCircle2 size={12}/> Pendente</span>
                                          )}
                                      </td>
                                      <td className="px-4 py-2 text-center">
                                          <button onClick={() => handleDeleteTransaction(t.id)} className="p-1 text-slate-500 hover:text-rose-500 transition-colors">
                                              <Trash2 size={14}/>
                                          </button>
                                      </td>
                                  </tr>
                              );
                          })
                      )}
                  </tbody>
              </table>
          </div>
      </div>
    </div>
  );
};

export default Dashboard;