import React, { useState, useEffect, useRef } from 'react';
import { Users, LayoutDashboard, FileText, Trash2, LogOut, ShieldAlert, BarChart, Eye, X, Download, Calendar, Receipt, ArrowUpRight, FileSpreadsheet, Landmark, Plus, Upload, Edit2, Save, Ban, Search } from 'lucide-react';

interface AdminPanelProps {
  onLogout: () => void;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'users' | 'audit' | 'banks'>('dashboard');
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [auditData, setAuditData] = useState<any[]>([]);
  const [adminBanks, setAdminBanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  
  // User Detail Modal States
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userDetails, setUserDetails] = useState<any>(null);
  const [detailTab, setDetailTab] = useState<'transactions' | 'forecasts' | 'files'>('transactions');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Bank Form States
  const [newBankName, setNewBankName] = useState('');
  const [newBankLogo, setNewBankLogo] = useState<string | null>(null);
  const [editingBankId, setEditingBankId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // CORREÇÃO: Usar o Token JWT do localStorage
  const getHeaders = () => {
      const token = localStorage.getItem('finance_app_token');
      return {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
      };
  };

  useEffect(() => { fetchStats(); }, []);
  
  useEffect(() => {
      if (activeTab === 'users') fetchUsers();
      if (activeTab === 'audit') fetchAuditData();
      if (activeTab === 'banks') fetchAdminBanks();
  }, [activeTab]);

  const fetchStats = async () => { 
      try {
        const res = await fetch('/api/admin/global-data', { headers: getHeaders() }); 
        if(res.ok) setStats(await res.json()); 
      } catch(e) { console.error(e); }
  };
  
  const fetchUsers = async () => { 
      setLoading(true); 
      try {
        const res = await fetch('/api/admin/users', { headers: getHeaders() }); 
        if(res.ok) setUsers(await res.json()); 
      } finally { setLoading(false); }
  };
  
  const fetchAuditData = async () => { 
      setLoading(true); 
      try {
        const res = await fetch('/api/admin/audit-transactions', { headers: getHeaders() }); 
        if(res.ok) setAuditData(await res.json()); 
      } finally { setLoading(false); }
  };
  
  const fetchAdminBanks = async () => { 
      setLoading(true); 
      try {
        const res = await fetch('/api/admin/banks', { headers: getHeaders() }); 
        if(res.ok) setAdminBanks(await res.json()); 
      } finally { setLoading(false); }
  };

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
      if (confirm(`ATENÇÃO: Isso excluirá permanentemente a empresa ${email} e TODOS os seus dados (lançamentos, contas, histórico). Esta ação não pode ser desfeita. Confirmar?`)) {
          const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE', headers: getHeaders() });
          if (res.ok) { 
              alert("Usuário removido com sucesso."); 
              fetchUsers(); 
              fetchStats(); 
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
              fetchAdminBanks(); 
              alert(editingBankId ? "Banco atualizado!" : "Banco criado!"); 
          } else {
              alert("Erro ao salvar banco.");
          }
      } catch (e) {
          console.error(e);
      }
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
      if(confirm("Deseja realmente excluir este banco global? Ele não aparecerá mais para novos usuários.")) { 
          await fetch(`/api/admin/banks/${id}`, { method: 'DELETE', headers: getHeaders() }); 
          fetchAdminBanks(); 
      } 
  };

  const handleDownloadOFX = (importId: number, fileName: string) => {
      fetch(`/api/admin/ofx-download/${importId}`, { headers: getHeaders() })
        .then(res => res.blob())
        .then(blob => { 
            const url = window.URL.createObjectURL(blob); 
            const a = document.createElement('a'); 
            a.href = url; 
            a.download = fileName; 
            document.body.appendChild(a); 
            a.click(); 
            a.remove(); 
        });
  };

  const filterByDate = (items: any[]) => items?.filter(item => { 
      const d = item.date || item.import_date; 
      return d && d.split('T')[0] >= startDate && d.split('T')[0] <= endDate; 
  }) || [];

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200">
      
      {/* Sidebar */}
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
                  <FileText size={20}/> Auditoria (Tx)
              </button>
          </nav>
          <div className="p-4 border-t border-slate-800">
              <button onClick={onLogout} className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors">
                  <LogOut size={20}/> Sair
              </button>
          </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-black p-8 relative">
          
          {/* Dashboard Tab */}
          {activeTab === 'dashboard' && stats && (
              <div className="space-y-6 animate-in fade-in">
                  <h2 className="text-2xl font-bold text-white mb-6">Visão Geral do Sistema</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                      <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
                          <h3 className="text-slate-400 font-medium mb-2">Total de Usuários</h3>
                          <p className="text-3xl font-bold text-white">{stats.users?.count}</p>
                      </div>
                      <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
                          <h3 className="text-slate-400 font-medium mb-2">Total de Lançamentos</h3>
                          <p className="text-3xl font-bold text-white">{stats.transactions?.count}</p>
                      </div>
                      <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
                          <h3 className="text-slate-400 font-medium mb-2">Volume Transacionado</h3>
                          <p className="text-3xl font-bold text-emerald-500">R$ {(stats.transactions?.totalValue || 0).toLocaleString('pt-BR', { notation: 'compact' })}</p>
                      </div>
                  </div>
              </div>
          )}

          {/* Users Tab */}
          {activeTab === 'users' && (
              <div className="space-y-6 animate-in fade-in">
                  <h2 className="text-2xl font-bold text-white">Gerenciar Usuários</h2>
                  <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden shadow-lg">
                      <table className="w-full text-sm text-left">
                          <thead className="bg-slate-800 text-slate-400 font-bold uppercase text-xs">
                              <tr>
                                  <th className="px-6 py-4">ID</th>
                                  <th className="px-6 py-4">Razão Social</th>
                                  <th className="px-6 py-4">Email / Login</th>
                                  <th className="px-6 py-4">CNPJ</th>
                                  <th className="px-6 py-4">Telefone</th>
                                  <th className="px-6 py-4 text-center">Ações</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800">
                              {users.map(u => (
                                  <tr key={u.id} className="hover:bg-slate-800/50">
                                      <td className="px-6 py-4 text-slate-500">#{u.id}</td>
                                      <td className="px-6 py-4 font-medium text-white">{u.razao_social || 'Sem Nome'}</td>
                                      <td className="px-6 py-4 text-slate-300">{u.email}</td>
                                      <td className="px-6 py-4 text-slate-400 font-mono text-xs">{u.cnpj}</td>
                                      <td className="px-6 py-4 text-slate-400 text-xs">{u.phone}</td>
                                      <td className="px-6 py-4 text-center flex items-center justify-center gap-2">
                                          <button 
                                            onClick={() => handleOpenUser(u)} 
                                            className="p-2 bg-blue-500/10 text-blue-500 rounded hover:bg-blue-500/20"
                                            title="Ver Detalhes"
                                          >
                                              <Eye size={18}/>
                                          </button> 
                                          <button 
                                            onClick={() => handleDeleteUser(u.id, u.email)} 
                                            className="p-2 bg-red-500/10 text-red-500 rounded hover:bg-red-500/20"
                                            title="Excluir Usuário"
                                          >
                                              <Trash2 size={18}/>
                                          </button>
                                      </td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
              </div>
          )}

          {/* Banks Tab */}
          {activeTab === 'banks' && (
              <div className="space-y-6 animate-in fade-in">
                  <h2 className="text-2xl font-bold text-white">Bancos Globais</h2>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                      {/* Form */}
                      <div className="lg:col-span-1">
                          <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl sticky top-6">
                              <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                                  {editingBankId ? <Edit2 size={18} className="text-blue-500"/> : <Plus size={18} className="text-emerald-500"/>}
                                  {editingBankId ? 'Editar Banco' : 'Novo Banco'}
                              </h3>
                              <form onSubmit={handleSaveBank} className="space-y-4">
                                  <div>
                                      <label className="text-xs text-slate-400 uppercase font-semibold">Nome da Instituição</label>
                                      <input 
                                          type="text" 
                                          required
                                          className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg p-2 text-white outline-none focus:border-blue-500"
                                          value={newBankName}
                                          onChange={e => setNewBankName(e.target.value)}
                                      />
                                  </div>
                                  <div>
                                      <label className="text-xs text-slate-400 uppercase font-semibold">Logo (Imagem)</label>
                                      <div className="mt-1 flex items-center gap-4">
                                          <div className="w-16 h-16 bg-white rounded-lg p-2 flex items-center justify-center border border-slate-700 overflow-hidden">
                                              {newBankLogo ? <img src={newBankLogo} className="max-w-full max-h-full object-contain"/> : <span className="text-slate-400 text-xs">Sem logo</span>}
                                          </div>
                                          <input 
                                              type="file" 
                                              accept="image/*"
                                              ref={fileInputRef}
                                              onChange={handleLogoUpload}
                                              className="text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-slate-300 hover:file:bg-slate-700"
                                          />
                                      </div>
                                  </div>
                                  <div className="flex gap-2 pt-2">
                                      {editingBankId && (
                                          <button type="button" onClick={handleCancelEdit} className="flex-1 py-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700">Cancelar</button>
                                      )}
                                      <button type="submit" className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 font-bold flex items-center justify-center gap-2">
                                          <Save size={18}/> Salvar
                                      </button>
                                  </div>
                              </form>
                          </div>
                      </div>

                      {/* List */}
                      <div className="lg:col-span-2">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {adminBanks.map(bank => (
                                  <div key={bank.id} className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex items-center justify-between group hover:border-slate-600 transition-colors">
                                      <div className="flex items-center gap-3">
                                          <div className="w-10 h-10 bg-white rounded-lg p-1.5 flex items-center justify-center">
                                              <img src={bank.logo} className="max-w-full max-h-full object-contain" onError={(e) => (e.target as HTMLImageElement).src=''} />
                                          </div>
                                          <span className="font-medium text-white">{bank.name}</span>
                                      </div>
                                      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                          <button onClick={() => handleEditBankClick(bank)} className="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-400/10 rounded"><Edit2 size={16}/></button>
                                          <button onClick={() => handleDeleteBank(bank.id)} className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded"><Trash2 size={16}/></button>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>
                  </div>
              </div>
          )}

          {/* Audit Tab */}
          {activeTab === 'audit' && (
              <div className="space-y-6 animate-in fade-in">
                  <h2 className="text-2xl font-bold text-white">Auditoria de Transações</h2>
                  <p className="text-slate-400 text-sm">Visualização global das últimas 500 transações registradas no sistema.</p>
                  <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden shadow-lg">
                      <div className="overflow-x-auto">
                          <table className="w-full text-sm text-left">
                              <thead className="bg-slate-800 text-slate-400 font-bold uppercase text-xs sticky top-0">
                                  <tr>
                                      <th className="px-6 py-4">Data</th>
                                      <th className="px-6 py-4">Empresa</th>
                                      <th className="px-6 py-4">Descrição</th>
                                      <th className="px-6 py-4">Tipo</th>
                                      <th className="px-6 py-4 text-right">Valor</th>
                                  </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800">
                                  {auditData.map((t, idx) => (
                                      <tr key={t.id || idx} className="hover:bg-slate-800/50">
                                          <td className="px-6 py-3 text-slate-400 font-mono text-xs">{new Date(t.date).toLocaleDateString()}</td>
                                          <td className="px-6 py-3 text-blue-400 font-medium">{t.razao_social}</td>
                                          <td className="px-6 py-3 text-slate-300">{t.description}</td>
                                          <td className="px-6 py-3">
                                              <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded border ${t.type === 'credito' ? 'text-emerald-500 border-emerald-500/20 bg-emerald-500/10' : 'text-rose-500 border-rose-500/20 bg-rose-500/10'}`}>
                                                  {t.type}
                                              </span>
                                          </td>
                                          <td className={`px-6 py-3 text-right font-mono font-bold ${t.type === 'credito' ? 'text-emerald-500' : 'text-rose-500'}`}>
                                              R$ {t.value?.toFixed(2)}
                                          </td>
                                      </tr>
                                  ))}
                              </tbody>
                          </table>
                      </div>
                  </div>
              </div>
          )}

      </main>

      {/* User Details Modal */}
      {selectedUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
              <div className="bg-slate-900 border border-slate-700 w-full max-w-5xl h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="p-6 border-b border-slate-800 flex justify-between items-start bg-slate-950">
                      <div>
                          <h2 className="text-2xl font-bold text-white">{selectedUser.razao_social}</h2>
                          <div className="flex gap-4 mt-2 text-sm text-slate-400">
                              <span>{selectedUser.email}</span>
                              <span>CNPJ: {selectedUser.cnpj}</span>
                          </div>
                      </div>
                      <button onClick={() => setSelectedUser(null)} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white">
                          <X size={24}/>
                      </button>
                  </div>

                  <div className="flex border-b border-slate-800 bg-slate-900">
                      <button onClick={() => setDetailTab('transactions')} className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${detailTab === 'transactions' ? 'border-blue-500 text-blue-500' : 'border-transparent text-slate-400 hover:text-white'}`}>Lançamentos</button>
                      <button onClick={() => setDetailTab('forecasts')} className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${detailTab === 'forecasts' ? 'border-blue-500 text-blue-500' : 'border-transparent text-slate-400 hover:text-white'}`}>Previsões</button>
                      <button onClick={() => setDetailTab('files')} className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${detailTab === 'files' ? 'border-blue-500 text-blue-500' : 'border-transparent text-slate-400 hover:text-white'}`}>Arquivos OFX</button>
                  </div>

                  <div className="p-4 bg-slate-900 border-b border-slate-800 flex items-center gap-4">
                      <span className="text-sm text-slate-400">Filtrar período:</span>
                      <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-3 py-1 text-sm text-white"/>
                      <span className="text-slate-500">até</span>
                      <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-3 py-1 text-sm text-white"/>
                  </div>

                  <div className="flex-1 overflow-auto p-6 bg-slate-950">
                      {loading ? (
                          <div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div></div>
                      ) : (
                          <>
                              {detailTab === 'transactions' && userDetails?.transactions && (
                                  <table className="w-full text-sm text-left">
                                      <thead className="text-slate-500 border-b border-slate-800">
                                          <tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Banco</th><th className="text-right">Valor</th></tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-800">
                                          {filterByDate(userDetails.transactions).map((t: any) => (
                                              <tr key={t.id} className="hover:bg-slate-900">
                                                  <td className="py-3 text-slate-400 font-mono">{new Date(t.date).toLocaleDateString()}</td>
                                                  <td className="py-3 text-white">{t.description}</td>
                                                  <td className="py-3 text-slate-400">{t.category_name}</td>
                                                  <td className="py-3 text-slate-400">{t.bank_name}</td>
                                                  <td className={`py-3 text-right font-bold ${t.type === 'credito' ? 'text-emerald-500' : 'text-rose-500'}`}>R$ {t.value.toFixed(2)}</td>
                                              </tr>
                                          ))}
                                      </tbody>
                                  </table>
                              )}

                              {detailTab === 'forecasts' && userDetails?.forecasts && (
                                  <table className="w-full text-sm text-left">
                                      <thead className="text-slate-500 border-b border-slate-800">
                                          <tr><th>Data</th><th>Descrição</th><th>Status</th><th className="text-right">Valor</th></tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-800">
                                          {filterByDate(userDetails.forecasts).map((f: any) => (
                                              <tr key={f.id} className="hover:bg-slate-900">
                                                  <td className="py-3 text-slate-400 font-mono">{new Date(f.date).toLocaleDateString()}</td>
                                                  <td className="py-3 text-white">{f.description}</td>
                                                  <td className="py-3"><span className={`text-xs px-2 py-1 rounded ${f.realized ? 'bg-emerald-900 text-emerald-400' : 'bg-amber-900 text-amber-400'}`}>{f.realized ? 'Realizado' : 'Pendente'}</span></td>
                                                  <td className={`py-3 text-right font-bold ${f.type === 'credito' ? 'text-emerald-500' : 'text-rose-500'}`}>R$ {f.value.toFixed(2)}</td>
                                              </tr>
                                          ))}
                                      </tbody>
                                  </table>
                              )}

                              {detailTab === 'files' && userDetails?.ofxImports && (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                      {filterByDate(userDetails.ofxImports).map((file: any) => (
                                          <div key={file.id} className="bg-slate-900 border border-slate-800 p-4 rounded-lg flex items-center justify-between">
                                              <div>
                                                  <p className="font-bold text-white text-sm truncate w-40" title={file.file_name}>{file.file_name}</p>
                                                  <p className="text-xs text-slate-500">{new Date(file.import_date).toLocaleDateString()} • {file.transaction_count} itens</p>
                                              </div>
                                              <button onClick={() => handleDownloadOFX(file.id, file.file_name)} className="p-2 bg-slate-800 hover:bg-slate-700 rounded text-slate-300"><Download size={16}/></button>
                                          </div>
                                      ))}
                                  </div>
                              )}
                          </>
                      )}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default AdminPanel;