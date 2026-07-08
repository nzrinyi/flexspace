import { useMemo, useState } from 'react';
import type { SenStatsAttendanceDocument, SenStatsSenatorDocument } from '../../types';
import { groupClassName, groupLabel } from './SenStatsHelpers';

type DashboardTab = 'groups' | 'retirement' | 'attendance';
type RetirementSort = 'date' | 'served';

function yearFromValue(value: string) {
  const match = value.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : 0;
}

function detailValue(senator: SenStatsSenatorDocument, keys: string[]) {
  const sources = [senator.extraDetails, senator.profileDetails, ...(senator.officeDetails ?? [])];
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) return value;
      if (typeof value === 'number') return String(value);
    }
  }
  return '';
}

function senatorAge(retirementDate: string) {
  const year = yearFromValue(retirementDate);
  return year ? 75 - Math.max(year - new Date().getFullYear(), 0) : undefined;
}

export function SenStatsDashboardsView({ senators, attendance }: { senators: SenStatsSenatorDocument[]; attendance: Array<SenStatsAttendanceDocument & { id: string }> }) {
  const [activeDashboard, setActiveDashboard] = useState<DashboardTab>('groups');
  const [retirementSort, setRetirementSort] = useState<RetirementSort>('date');
  const groups = useMemo(() => Array.from(senators.reduce((map, senator) => map.set(senator.party, (map.get(senator.party) ?? 0) + 1), new Map<string, number>())).sort((a, b) => b[1] - a[1]), [senators]);
  const retirementRows = useMemo(() => senators.map((senator) => {
    const retirementDate = detailValue(senator, ['retirementDate', 'retirement-date', 'mandatory-retirement-date', 'retirement']);
    const appointedDate = detailValue(senator, ['nominatedDate', 'appointed-date', 'appointedDate', 'summoned-to-the-senate', 'date-of-appointment']);
    const retirementYear = yearFromValue(retirementDate);
    const appointedYear = yearFromValue(appointedDate);
    return { senator, retirementDate, appointedDate, age: senatorAge(retirementDate), yearsServed: appointedYear ? Math.max(new Date().getFullYear() - appointedYear, 0) : 0, retirementYear: retirementYear || 9999 };
  }).sort((a, b) => retirementSort === 'served' ? b.yearsServed - a.yearsServed : a.retirementYear - b.retirementYear), [retirementSort, senators]);
  const attendanceRows = useMemo(() => [...attendance].sort((a, b) => (Number(b.present || 0) / Math.max(Number(b.sittingDays || 0), 1)) - (Number(a.present || 0) / Math.max(Number(a.sittingDays || 0), 1))), [attendance]);

  return <section className="dashboards-view" aria-label="SenStats dashboards">
    <div className="dashboard-overview-banner">
      <span>Dashboards</span>
      <strong>Group counts, retirement order, and attendance in one place</strong>
      <small>Use the nested tabs below to switch between the three dashboard views.</small>
    </div>
    <div className="senstats-tabs nested-tabs" role="tablist" aria-label="Dashboards">
      {(['groups', 'retirement', 'attendance'] as DashboardTab[]).map((tab) => <button key={tab} type="button" className={activeDashboard === tab ? 'active' : ''} onClick={() => setActiveDashboard(tab)}>{tab === 'groups' ? 'Groups' : tab === 'retirement' ? 'Retirement' : 'Attendance'}</button>)}
    </div>

    {activeDashboard === 'groups' && <div className="dashboard-card-grid">
      {groups.map(([group, count]) => <article key={group} className={`dashboard-metric-card ${groupClassName(group)}`}><span>{groupLabel(group)}</span><strong>{count}</strong><small>{Math.round((count / Math.max(senators.length, 1)) * 100)}% of current senators</small></article>)}
    </div>}

    {activeDashboard === 'retirement' && <div className="source-card source-wide"><div className="source-heading"><span>Retirement</span><strong>Upcoming retirements and tenure</strong><select value={retirementSort} onChange={(event) => setRetirementSort(event.target.value as RetirementSort)}><option value="date">Retiring soonest</option><option value="served">Longest served</option></select></div><div className="dashboard-table" role="table" aria-label="Senator retirement dashboard"><div role="row" className="source-table-head"><span>Name</span><span>Group</span><span>Retirement</span><span>Approx. age</span><span>Years served</span></div>{retirementRows.map(({ senator, retirementDate, age, yearsServed }) => <div role="row" key={senator.id} className={groupClassName(senator.party)}><strong>{senator.name}</strong><em>{groupLabel(senator.party)}</em><span>{retirementDate || 'Not synced'}</span><span>{age ?? '—'}</span><span>{yearsServed || '—'}</span></div>)}</div></div>}

    {activeDashboard === 'attendance' && <div className="source-card source-wide"><div className="source-heading"><span>Attendance</span><strong>Senators' Attendance and Activities on Sitting Days</strong><a href="https://sencanada.ca/en/attendance/" target="_blank" rel="noreferrer">Open source</a></div>{attendanceRows.length === 0 ? <p className="muted">No attendance rows synced yet. The ingestion script reads the public attendance register and stores summary rows after the next sync.</p> : <div className="dashboard-table attendance-table" role="table" aria-label="Senator attendance dashboard"><div role="row" className="source-table-head"><span>Name</span><span>Group</span><span>Sitting days</span><span>Present/business</span><span>Leave</span></div>{attendanceRows.map((row) => <div role="row" key={row.id} className={groupClassName(row.party || '')}><strong>{row.senatorName}</strong><em>{groupLabel(row.party || 'Unknown')}</em><span>{row.sittingDays ?? '—'}</span><span>{row.present ?? '—'}</span><span>{row.leave ?? '—'}</span></div>)}</div>}</div>}
  </section>;
}
