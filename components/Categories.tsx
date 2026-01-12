import React, { useState } from 'react';
import { Category, CategoryType } from '../types';
import { Plus, Trash2, Tag, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';

interface CategoriesProps {
  categories: Category[];
  onAddCategory: (category: Omit<Category, 'id'>) => void;
  onDeleteCategory: (id: number) => void;
}

const Categories: React.FC<CategoriesProps> = ({ categories, onAddCategory, onDeleteCategory }) => {
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryType, setNewCategoryType] = useState<CategoryType>(CategoryType.EXPENSE);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    
    onAddCategory({
      name: newCategoryName,
      type: newCategoryType
    });
    setNewCategoryName('');
  };

  const incomeCategories = categories.filter(c => c.type === CategoryType.INCOME);
  const expenseCategories = categories.filter(c => c.type === CategoryType.EXPENSE);

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
             <div className="flex-1 overflow-y-auto max-h-[500px]">
                 {incomeCategories.length === 0 ? (
                     <div className="p-8 text-center text-slate-500">Nenhuma categoria cadastrada.</div>
                 ) : (
                     <ul className="divide-y divide-slate-800">
                         {incomeCategories.map(cat => (
                             <li key={cat.id} className="px-6 py-3 flex justify-between items-center hover:bg-slate-800/50 group">
                                 <span className="text-slate-300 font-medium">{cat.name}</span>
                                 <button 
                                    onClick={() => onDeleteCategory(cat.id)}
                                    className="p-1.5 text-slate-500 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                                    title="Excluir"
                                 >
                                     <Trash2 size={16} />
                                 </button>
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
             <div className="flex-1 overflow-y-auto max-h-[500px]">
                 {expenseCategories.length === 0 ? (
                     <div className="p-8 text-center text-slate-500">Nenhuma categoria cadastrada.</div>
                 ) : (
                     <ul className="divide-y divide-slate-800">
                         {expenseCategories.map(cat => (
                             <li key={cat.id} className="px-6 py-3 flex justify-between items-center hover:bg-slate-800/50 group">
                                 <span className="text-slate-300 font-medium">{cat.name}</span>
                                 <button 
                                    onClick={() => onDeleteCategory(cat.id)}
                                    className="p-1.5 text-slate-500 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                                    title="Excluir"
                                 >
                                     <Trash2 size={16} />
                                 </button>
                             </li>
                         ))}
                     </ul>
                 )}
             </div>
          </div>
      </div>
    </div>
  );
};

export default Categories;