import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SenStatsExpenseDocument } from '../../types';
import { currency, expenseCategoryColors, quarterlyExpenseRows } from './SenStatsHelpers';

interface SenStatsExpenseChartProps {
  expenses: Array<SenStatsExpenseDocument & { id: string }>;
  loading: boolean;
}

export function SenStatsExpenseChart({ expenses, loading }: SenStatsExpenseChartProps) {
  const rows = quarterlyExpenseRows(expenses);
  const categories = Array.from(new Set(rows.flatMap((row) => Object.keys(row).filter((key) => key !== 'quarter'))));
  if (loading) return <div className="senstats-chart-empty"><div className="empty-graphic pulse" /><strong>Loading expense trend…</strong><span>Listening for quarterly disclosure records.</span></div>;
  if (!rows.length) return <div className="senstats-chart-empty"><div className="empty-graphic" aria-hidden="true">∅</div><strong>No expense data available yet</strong><span>Once the sync finds quarterly records, this panel will become a spending trend chart.</span></div>;
  return <div className="senstats-chart"><ResponsiveContainer width="100%" height={220}><BarChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf7" /><XAxis dataKey="quarter" tick={{ fill: '#475569', fontSize: 12, fontWeight: 700 }} /><YAxis tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} tick={{ fill: '#64748b', fontSize: 12 }} width={48} /><Tooltip formatter={(value) => currency(Number(value))} contentStyle={{ borderRadius: 14, border: '1px solid #e8edf7' }} /><Legend wrapperStyle={{ fontSize: 12, fontWeight: 800 }} />{categories.map((category) => <Bar key={category} dataKey={category} stackId="expenses" fill={expenseCategoryColors[category] ?? expenseCategoryColors.Other} radius={[6, 6, 0, 0]} />)}</BarChart></ResponsiveContainer></div>;
}
