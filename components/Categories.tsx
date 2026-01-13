import React, { useState } from 'react';
import { Category, CategoryType } from '../types';
import { Plus, Trash2, Tag, ArrowUpCircle, ArrowDownCircle, Settings, X, Save } from 'lucide-react';

interface CategoriesProps {
  categories: Category[];
  onAddCategory: (category: Omit<Category, 'id'>) => void;
  onDeleteCategory: (id: number) => void;
  onUpdateCategory?: (category: Category) => void;
}

// Grupos baseados na estrutura de DRE do server.js
const INCOME_GROUPS = [
    { id: 'receita_bruta', label: 'Receita Bruta de Vendas/Serviços' },
    { id: 'outras_receitas', label: 'Outras Receitas Operacionais' },
    { id: 'receita_financeira', label: 'Receitas Financeiras' },
    { id: 'receita_nao_operacional', label: 'Receitas Não Operacionais' },
    { id: 'nao_operacional', label: 'Movimentações Internas (Não afeta DRE)' }
];

const EXPENSE_GROUPS = [
    { id: 'cmv', label: 'Custos (CMV / CSP)' },
    { id: 'despesa_operacional', label: 'Despesas Operacionais Gerais' },
    { id: 'despesa_pessoal', label: 'Despesas com Pessoal' },
    { id: 'despesa_administrativa', label: 'Despesas Administrativas' },
    { id: 'impostos', label: 'Impostos e Taxas' },
    { id: 'despesa_financeira', label: 'Despesas Financeiras' },
    { id: 'despesa_nao_operacional', label: 'Despesas Não Operacionais' },
    { id: 'nao_operacional', label: 'Movimentações Internas (Não afeta DRE)' }
];

const Categories: React.FC<CategoriesProps> = ({ categories, onAddCategory, onDeleteCategory, onUpdateCategory }) => {
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryType, setNewCategoryType] = useState<CategoryType>(CategoryType.EXPENSE);
  
  // Edit Group Modal State
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    
    // Default groups based on type
    const defaultGroup = newCategoryType === CategoryType.INCOME ? 'outras_receitas' : 'despesa_operacional';

    onAddCategory({
      name: newCategoryName,
      type: newCategoryType,
      groupType: defaultGroup
    });
    setNewCategoryName('');
  };

  const openConfigModal = (cat: Category) => {
      setEditingCategory(cat);
      setSelectedGroup(cat.groupType || (cat.type === CategoryType.INCOME ? 'outras_receitas' : 'despesa_operacional'));
  };

  const handleSaveGroup = () => {
      if (editingCategory && onUpdateCategory) {
          onUpdateCategory({
              ...editingCategory,
              groupType: selectedGroup
          });
          setEditingCategory(null);
      }
  };

  const incomeCategories = categories.filter(c => c.type === CategoryType.INCOME);
  const expenseCategories = categories.filter(c => c.type === CategoryType.EXPENSE);

  const getGroupLabel = (groupId?: string, type?: CategoryType) => {
      if (!groupId) return 'Não Configurado';
      const list = type === CategoryType.INCOME ? INCOME_GROUPS : EXPENSE_GROUPS;
      return list.find(g => g.id === groupId)?.label || groupId;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Categorias</h1>
        <p className="text-slate-400">Gerencie as categorias de receitas e despesas</p>
      </div>

      {/* Add New Category Form */}
      <div className="bg-surface p-6 rounded-xl border border-slate-800 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
           <Plus className="text-primary" size={20}/> Nova Categoria
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 w-full">
                <label className="text-sm font-medium text-slate-400 block mb-1">Nome da Categoria</label>
                <input 
                    type="text" 
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none text-white placeholder-slate-600"
                    placeholder="Ex: Marketing Digital"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                />
            </div>
            <div className="w-full md:w-48">
                <label className="text-sm font-medium text-slate-400 block mb-1">Tipo</label>
                <select 
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none text-white"
                    value={newCategoryType}
                    onChange={(e) => setNewCategoryType(e.target.value as CategoryType)}
                >
                    <option value={CategoryType.EXPENSE}>Despesa</option>
                    <option value={CategoryType.INCOME}>Receita</option>
                </select>
            </div>
            <button 
                type="submit"
                className="w-full md:w-auto px-6 py-2 bg-primary text-slate-900 rounded-lg hover:bg-primaryHover font-medium transition-colors shadow-sm"
            >
                Adicionar
            </button>
        </form>
      </div>

      {/* Lists */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Income List */}
          <div className="bg-surface rounded-xl border border-slate-800 shadow-sm overflow-hidden flex flex-col h-full">
             <div className="px-6 py-4 border-b border-slate-800 bg-emerald-900/20 flex items-center gap-2">
                 <ArrowUpCircle className="text-emerald-500" size={20} />
                 <h3 className="font-bold text-slate-200">Categorias de Receita</h3>
                 <span className="ml-auto bg-emerald-500/10 text-emerald-500 text-xs font-bold px-2 py-1 rounded-full border border-emerald-500/20">
                     {incomeCategories.length}
                 </span>
             </div>
             <div className="flex-1 overflow-y-auto max-h-[500px] custom-scroll">
                 {incomeCategories.length === 0 ? (
                     <div className="p-8 text-center text-slate-500">Nenhuma categoria cadastrada.</div>
                 ) : (
                     <ul className="divide-y divide-slate-800">
                         {incomeCategories.map(cat => (
                             <li key={cat.id} className="px-6 py-3 flex justify-between items-center hover:bg-slate-800/50 group transition-colors">
                                 <div>
                                     <span className="text-slate-300 font-medium block">{cat.name}</span>
                                     <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                                         {getGroupLabel(cat.groupType, CategoryType.INCOME)}
                                     </span>
                                 </div>
                                 <div className="flex gap-2">
                                     <button 
                                        onClick={() => openConfigModal(cat)}
                                        className="p-1.5 text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-colors"
                                        title="Configurar Grupo"
                                     >
                                         <Settings size={16} />
                                     </button>
                                     <button 
                                        onClick={() => onDeleteCategory(cat.id)}
                                        className="p-1.5 text-slate-500 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                                        title="Excluir"
                                     >
                                         <Trash2 size={16} />
                                     </button>
                                 </div>
                             </li>
                         ))}
                     </ul>
                 )}
             </div>
          </div>

          {/* Expense List */}
          <div className="bg-surface rounded-xl border border-slate-800 shadow-sm overflow-hidden flex flex-col h-full">
             <div className="px-6 py-4 border-b border-slate-800 bg-rose-900/20 flex items-center gap-2">
                 <ArrowDownCircle className="text-rose-500" size={20} />
                 <h3 className="font-bold text-slate-200">Categorias de Despesa</h3>
                 <span className="ml-auto bg-rose-500/10 text-rose-500 text-xs font-bold px-2 py-1 rounded-full border border-rose-500/20">
                     {expenseCategories.length}
                 </span>
             </div>
             <div className="flex-1 overflow-y-auto max-h-[500px] custom-scroll">
                 {expenseCategories.length === 0 ? (
                     <div className="p-8 text-center text-slate-500">Nenhuma categoria cadastrada.</div>
                 ) : (
                     <ul className="divide-y divide-slate-800">
                         {expenseCategories.map(cat => (
                             <li key={cat.id} className="px-6 py-3 flex justify-between items-center hover:bg-slate-800/50 group transition-colors">
                                 <div>
                                     <span className="text-slate-300 font-medium block">{cat.name}</span>
                                     <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                                         {getGroupLabel(cat.groupType, CategoryType.EXPENSE)}
                                     </span>
                                 </div>
                                 <div className="flex gap-2">
                                     <button 
                                        onClick={() => openConfigModal(cat)}
                                        className="p-1.5 text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-colors"
                                        title="Configurar Grupo"
                                     >
                                         <Settings size={16} />
                                     </button>
                                     <button 
                                        onClick={() => onDeleteCategory(cat.id)}
                                        className="p-1.5 text-slate-500 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                                        title="Excluir"
                                     >
                                         <Trash2 size={16} />
                                     </button>
                                 </div>
                             </li>
                         ))}
                     </ul>
                 )}
             </div>
          </div>
      </div>

      {/* Config Modal */}
      {editingCategory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setEditingCategory(null)} />
              <div className="relative bg-surface border border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
                  <div className="flex justify-between items-center mb-6">
                      <h3 className="text-lg font-bold text-white flex items-center gap-2">
                          <Settings size={20} className="text-primary"/> Configurar Categoria
                      </h3>
                      <button onClick={() => setEditingCategory(null)}><X size={20} className="text-slate-400 hover:text-white"/></button>
                  </div>
                  
                  <div className="space-y-4">
                      <div>
                          <label className="text-xs font-semibold text-slate-500 uppercase">Categoria</label>
                          <p className="text-white font-medium text-lg">{editingCategory.name}</p>
                      </div>
                      
                      <div>
                          <label className="text-sm font-medium text-slate-300 block mb-2">Grupo Contábil (Para Relatórios/DRE)</label>
                          <select 
                              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white outline-none focus:border-primary"
                              value={selectedGroup}
                              onChange={(e) => setSelectedGroup(e.target.value)}
                          >
                              {(editingCategory.type === CategoryType.INCOME ? INCOME_GROUPS : EXPENSE_GROUPS).map(g => (
                                  <option key={g.id} value={g.id}>{g.label}</option>
                              ))}
                          </select>
                          <p className="text-xs text-slate-500 mt-2">
                              Isso define onde esta categoria aparecerá no Demonstrativo de Resultados (DRE).
                          </p>
                      </div>

                      <div className="flex gap-3 pt-4">
                          <button onClick={() => setEditingCategory(null)} className="flex-1 py-2 border border-slate-700 text-slate-300 rounded-lg hover:bg-slate-800">Cancelar</button>
                          <button onClick={handleSaveGroup} className="flex-1 py-2 bg-primary text-slate-900 font-bold rounded-lg hover:bg-primaryHover flex justify-center items-center gap-2">
                              <Save size={18}/> Salvar
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default Categories;