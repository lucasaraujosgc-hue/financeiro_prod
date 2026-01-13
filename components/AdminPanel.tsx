import React, { useState, useEffect, useRef } from 'react';
import { Users, LayoutDashboard, FileText, Trash2, LogOut, ShieldAlert, BarChart, Eye, X, Download, Calendar, Receipt, ArrowUpRight, FileSpreadsheet, Landmark, Plus, Upload, Edit2, Save, Ban, Search, Printer } from 'lucide-react';

interface AdminPanelProps {
  token: string;
  onLogout: () => void;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ token, onLogout }) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'users' | 'audit' | 'banks'>('dashboard');
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [auditData, setAuditData] = useState<any[]>([]);
  const [adminBanks, setAdminBanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userDetails, setUserDetails] = useState<any>(null);
  const [detailTab, setDetailTab] = useState<'transactions' | 'forecasts' | 'files'>('transactions');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [newBankName, setNewBankName] = useState('');
  const [newBankLogo, setNewBankLogo] = useState<string | null>(null);
  const [editingBankId, setEditingBankId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getHeaders = () => {
      return {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
      };
  };

  // Carregamento unificado para evitar race conditions
  useEffect(() => {
      const fetchData = async () => {
          setLoading(true);
          try {
              if (activeTab === 'dashboard') {
                  const res = await fetch('/api/admin/global-data', { headers: getHeaders() });
                  if(res.ok) setStats(await res.json());
              }
              else if (activeTab === 'users') {
                  const res = await fetch('/api/admin/users', { headers: getHeaders() });
                  if(res.ok) setUsers(await res.json());
              }
              else if (activeTab === 'audit') {
                  const res = await fetch('/api/admin/audit-transactions', { headers: getHeaders() });
                  if(res.ok) setAuditData(await res.json());
              }
              else if (activeTab === 'banks') {
                  const res = await fetch('/api/admin/banks', { headers: getHeaders() });
                  if(res.ok) setAdminBanks(await res.json());
              }
          } catch (e) {
              console.error("Erro ao carregar dados:", e);
          } finally {
              setLoading(false);
          }
      };

      if (token) fetchData();
  }, [activeTab, token]);

  const handleOpenUser = async (user: any) => {
      setSelectedUser(user); 
      setLoading(true);
      const today = new Date(); 
      setStartDate(new Date(today.getFullYear(), 0, 1).toISOString().split('T')[0]); 
      setEndDate(new Date(today.getFullYear(), 11, 31).toISOString().split('T')[0]);
      
      try { 
          const res = await fetch(`/api/admin/users/${user.id}/full-data`, { headers: getHeaders() }); 
          if (res.ok) setUserDetails(await res.json()); 
      } finally { 
          setLoading(false); 
      }
  };

  const handleDeleteUser = async (id: number, email: string) => {
      if (confirm(`ATENÇÃO: Isso excluirá permanentemente a empresa ${email} e TODOS os seus dados. Confirmar?`)) {
          const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE', headers: getHeaders() });
          if (res.ok) { 
              alert("Usuário removido."); 
              // Refresh user list
              const refresh = await fetch('/api/admin/users', { headers: getHeaders() });
              if(refresh.ok) setUsers(await refresh.json());
              setSelectedUser(null); 
          }
      }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) { 
          const reader = new FileReader(); 
          reader.onloadend = () => { setNewBankLogo(reader.result as string); }; 
          reader.readAsDataURL(file); 
      }
  };

  const handleSaveBank = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newBankName) return alert("Nome do banco é obrigatório");
      
      const url = editingBankId ? `/api/admin/banks/${editingBankId}` : '/api/admin/banks';
      const method = editingBankId ? 'PUT' : 'POST';
      
      try {
          const res = await fetch(url, { 
              method, 
              headers: getHeaders(), 
              body: JSON.stringify({ name: newBankName, logoData: newBankLogo }) 
          });
          
          if (res.ok) { 
              handleCancelEdit(); 
              // Force refresh banks list
              const refresh = await fetch('/api/admin/banks', { headers: getHeaders() });
              if(refresh.ok) setAdminBanks(await refresh.json());
              alert(editingBankId ? "Atualizado!" : "Criado!"); 
          } else {
              alert("Erro ao salvar.");
          }
      } catch (e) { console.error(e); }
  };

  const handleEditBankClick = (bank: any) => { 
      setEditingBankId(bank.id); 
      setNewBankName(bank.name); 
      setNewBankLogo(bank.logo); 
  };
  
  const handleCancelEdit = () => { 
      setEditingBankId(null); 
      setNewBankName(''); 
      setNewBankLogo(null); 
      if(fileInputRef.current) fileInputRef.current.value = '';
  };
  
  const handleDeleteBank = async (id: number) => { 
      if(confirm("Excluir este banco global?")) { 
          await fetch(`/api/admin/banks/${id}`, { method: 'DELETE', headers: getHeaders() }); 
          // Force refresh
          const refresh = await fetch('/api/admin/banks', { headers: getHeaders() });
          if(refresh.ok) setAdminBanks(await refresh.json());
      } 
  };

  const handleDownloadOFX = (importId: number, fileName: string) => {
      fetch(`/api/admin/ofx-download/${importId}`, { headers: getHeaders() })
        .then(res => res.blob())
        .then(blob => { 
            const url = window.URL.createObjectURL(blob); 
            const a = document.createElement('a'); 
            a.href = url; a.download = fileName; 
            document.body.appendChild(a); a.click(); a.remove(); 
        });
  };

  const filterByDate = (items: any[]) => items?.filter(item => { 
      const d = item.date || item.import_date; 
      return d && d.split('T')[0] >= startDate && d.split('T')[0] <= endDate; 
  }) || [];

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200">
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
          <div className="p-6 border-b border-slate-800 flex items-center gap-2">
              <ShieldAlert className="text-red-500" size={24}/>
              <h1 className="font-bold text-lg text-white">Admin Master</h1>
          </div>
          <nav className="flex-1 p-4 space-y-2">
              <button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${activeTab === 'dashboard' ? 'bg-red-500/10 text-red-500' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
                  <LayoutDashboard size={20}/> Dashboard
              </button>
              <button onClick={() => setActiveTab('users')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${activeTab === 'users' ? 'bg-red-500/10 text-red-500' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
                  <Users size={20}/> Usuários
              </button>
              <button onClick={() => setActiveTab('banks')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${activeTab === 'banks' ? 'bg-red-500/10 text-red-500' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
                  <Landmark size={20}/> Bancos Globais
              </button>
              <button onClick={() => setActiveTab('audit')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${activeTab === 'audit' ? 'bg-red-500/10 text-red-500' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
                  <FileText size={20}/> Auditoria
              </button>
          </nav>
          <div className="p-4 border-t border-slate-800">
              <button onClick={onLogout} className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors">
                  <LogOut size={20}/> Sair
              </button>
          </div>
      </aside>

      <main className="flex-1 overflow-auto bg-black p-8 relative">
          {activeTab === 'dashboard' && stats && (
              <div className="space-y-6 animate-in fade-in">
                  <h2 className="text-2xl font-bold text-white mb-6">Visão Geral</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
                          <h3 className="text-slate-400 font-medium mb-2">Usuários</h3>
                          <p className="text-3xl font-bold text-white">{stats.users?.count || 0}</p>
                      </div>
                      <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
                          <h3 className="text-slate-400 font-medium mb-2">Lançamentos</h3>
                          <p className="text-3xl font-bold text-white">{stats.transactions?.count || 0}</p>
                      </div>
                      <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
                          <h3 className="text-slate-400 font-medium mb-2">Volume</h3>
                          <p className="text-3xl font-bold text-emerald-500">R$ {(stats.transactions?.totalValue || 0).toLocaleString('pt-BR', { notation: 'compact' })}</p>
                      </div>
                  </div>
              </div>
          )}

          {activeTab === 'users' && (
              <div className="space-y-6 animate-in fade-in">
                  <h2 className="text-2xl font-bold text-white">Gerenciar Usuários</h2>
                  <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden shadow-lg">
                      <table className="w-full text-sm text-left">
                          <thead className="bg-slate-800 text-slate-400 font-bold uppercase text-xs">
                              <tr>
                                  <th className="px-6 py-4">Razão Social</th>
                                  <th className="px-6 py-4">Email</th>
                                  <th className="px-6 py-4">CNPJ</th>
                                  <th className="px-6 py-4 text-center">Ações</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800">
                              {users.length === 0 ? (
                                  <tr><td colSpan={4} className="px-6 py-8 text-center text-slate-500">Nenhum usuário.</td></tr>
                              ) : (
                                  users.map(u => (
                                      <tr key={u.id} className="hover:bg-slate-800/50">
                                          <td className="px-6 py-4 font-medium text-white">{u.razao_social}</td>
                                          <td className="px-6 py-4 text-slate-300">{u.email}</td>
                                          <td className="px-6 py-4 text-slate-400 font-mono text-xs">{u.cnpj}</td>
                                          <td className="px-6 py-4 text-center flex items-center justify-center gap-2">
                                              <button onClick={() => handleOpenUser(u)} className="p-2 bg-blue-500/10 text-blue-500 rounded"><Eye size={18}/></button> 
                                              <button onClick={() => handleDeleteUser(u.id, u.email)} className="p-2 bg-red-500/10 text-red-500 rounded"><Trash2 size={18}/></button>
                                          </td>
                                      </tr>
                                  ))
                              )}
                          </tbody>
                      </table>
                  </div>
              </div>
          )}

          {activeTab === 'banks' && (
              <div className="space-y-6 animate-in fade-in">
                  <h2 className="text-2xl font-bold text-white">Bancos Globais</h2>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                      <div className="lg:col-span-1">
                          <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl sticky top-6">
                              <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                                  {editingBankId ? <Edit2 size={18} className="text-blue-500"/> : <Plus size={18} className="text-emerald-500"/>}
                                  {editingBankId ? 'Editar Banco' : 'Novo Banco'}
                              </h3>
                              <form onSubmit={handleSaveBank} className="space-y-4">
                                  <input type="text" required className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white outline-none" value={newBankName} onChange={e => setNewBankName(e.target.value)} placeholder="Nome da Instituição"/>
                                  <div className="mt-1 flex items-center gap-4">
                                      <div className="w-16 h-16 bg-white rounded-lg p-2 flex items-center justify-center border border-slate-700 overflow-hidden">
                                          {newBankLogo ? <img src={newBankLogo} className="max-w-full max-h-full object-contain"/> : <span className="text-slate-400 text-xs">Sem logo</span>}
                                      </div>
                                      <input type="file" accept="image/*" ref={fileInputRef} onChange={handleLogoUpload} className="text-sm text-slate-400"/>
                                  </div>
                                  <div className="flex gap-2 pt-2">
                                      {editingBankId && <button type="button" onClick={handleCancelEdit} className="flex-1 py-2 bg-slate-800 text-slate-300 rounded-lg">Cancelar</button>}
                                      <button type="submit" className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-bold">Salvar</button>
                                  </div>
                              </form>
                          </div>
                      </div>
                      <div className="lg:col-span-2">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {adminBanks.map(bank => (
                                  <div key={bank.id} className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center justify-between group">
                                      <div className="flex items-center gap-3">
                                          <div className="w-10 h-10 bg-white rounded-lg p-1.5 flex items-center justify-center"><img src={bank.logo} className="max-w-full max-h-full object-contain" onError={(e) => (e.target as HTMLImageElement).src=''} /></div>
                                          <span className="font-medium text-white">{bank.name}</span>
                                      </div>
                                      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                          <button onClick={() => handleEditBankClick(bank)} className="p-2 text-blue-400 hover:bg-blue-400/10 rounded"><Edit2 size={16}/></button>
                                          <button onClick={() => handleDeleteBank(bank.id)} className="p-2 text-red-400 hover:bg-red-400/10 rounded"><Trash2 size={16}/></button>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>
                  </div>
              </div>
          )}

          {activeTab === 'audit' && (
              <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden shadow-lg">
                  <table className="w-full text-sm text-left">
                      <thead className="bg-slate-800 text-slate-400 font-bold uppercase text-xs">
                          <tr><th className="px-6 py-4">Data</th><th className="px-6 py-4">Empresa</th><th className="px-6 py-4">Descrição</th><th className="px-6 py-4 text-right">Valor</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                          {auditData.map((t, idx) => (
                              <tr key={idx} className="hover:bg-slate-800/50">
                                  <td className="px-6 py-3 text-slate-400">{new Date(t.date).toLocaleDateString()}</td>
                                  <td className="px-6 py-3 text-blue-400">{t.razao_social}</td>
                                  <td className="px-6 py-3 text-slate-300">{t.description}</td>
                                  <td className={`px-6 py-3 text-right font-bold ${t.type==='credito'?'text-emerald-500':'text-rose-500'}`}>R$ {t.value?.toFixed(2)}</td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
          )}
      </main>

      {/* User Details Modal (Simplificado para brevidade, mantendo lógica de fetch) */}
      {selectedUser && userDetails && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
              <div className="bg-slate-900 border border-slate-700 w-full max-w-5xl h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
                  <div className="p-6 border-b border-slate-800 flex justify-between bg-slate-950">
                      <h2 className="text-2xl font-bold text-white">{selectedUser.razao_social}</h2>
                      <button onClick={() => setSelectedUser(null)} className="text-slate-400 hover:text-white"><X size={24}/></button>
                  </div>
                  <div className="flex-1 overflow-auto p-6">
                      <h3 className="text-white font-bold mb-4">Lançamentos</h3>
                      <table className="w-full text-sm text-left">
                          <thead className="text-slate-500 border-b border-slate-800"><tr><th>Data</th><th>Descrição</th><th className="text-right">Valor</th></tr></thead>
                          <tbody className="divide-y divide-slate-800">
                              {filterByDate(userDetails.transactions).map((t: any) => (
                                  <tr key={t.id}><td className="py-2 text-slate-400">{t.date}</td><td className="py-2 text-white">{t.description}</td><td className="py-2 text-right text-slate-300">{t.value}</td></tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default AdminPanel;