import type { SenStatsExpenseDocument } from '../../types';

export function currency(amount: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(amount || 0);
}

export function groupClassName(group: string) {
  const normalized = group.toLowerCase();
  if (normalized.includes('non-affiliated') || normalized.includes('non affiliated')) return 'group-na';
  if (normalized.includes('independent') || normalized === 'isg') return 'group-isg';
  if (normalized.includes('conservative') || normalized === 'cpc' || normalized === 'c') return 'group-conservative';
  if (normalized.includes('canadian senators') || normalized === 'csg') return 'group-csg';
  if (normalized.includes('progressive') || normalized === 'psg') return 'group-psg';
  if (normalized.includes('government') || normalized === 'gro') return 'group-gro';
  return 'group-na';
}

export function groupLabel(group: string) {
  const normalized = group.toLowerCase();
  if (normalized.includes('independent senators') || normalized === 'isg') return 'ISG';
  if (normalized.includes('progressive') || normalized === 'psg') return 'PSG';
  if (normalized.includes('canadian senators') || normalized === 'csg') return 'CSG';
  if (normalized.includes('government') || normalized === 'gro') return 'GRO';
  if (normalized.includes('conservative') || normalized === 'cpc' || normalized === 'c') return 'CPC';
  if (normalized.includes('non-affiliated') || normalized.includes('non affiliated')) return 'Non-affiliated';
  return group;
}

export function categoryKey(category: string) {
  const normalized = category.toLowerCase();
  if (normalized.includes('travel')) return 'Travel';
  if (normalized.includes('office')) return 'Office';
  if (normalized.includes('hospitality')) return 'Hospitality';
  if (normalized.includes('living')) return 'Living';
  return category || 'Other';
}

export const expenseCategoryColors: Record<string, string> = {
  Travel: '#2563eb',
  Office: '#16a34a',
  Hospitality: '#d97706',
  Living: '#7c3aed',
  Other: '#64748b',
};

export function quarterlyExpenseRows(expenses: Array<SenStatsExpenseDocument & { id: string }>) {
  const rows = new Map<string, Record<string, string | number>>();
  for (const expense of expenses) {
    const quarter = expense.quarter || 'Unknown';
    const key = categoryKey(expense.category || 'Other');
    const row = rows.get(quarter) ?? { quarter };
    row[key] = Number(row[key] || 0) + (Number(expense.amount) || 0);
    rows.set(quarter, row);
  }
  return Array.from(rows.values()).sort((a, b) => String(a.quarter).localeCompare(String(b.quarter)));
}
