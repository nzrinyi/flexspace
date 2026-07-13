import { useMemo, useState } from 'react';
import type { SenStatsAttendanceDocument, SenStatsExpenseDocument, SenStatsSenatorDocument } from '../../types';
import { SenStatsExpensesDashboardView } from './SenStatsExpensesDashboardView';
import { SenStatsGroupsView } from './SenStatsGroupsView';
import { groupClassName, groupLabel } from './SenStatsHelpers';

type DashboardTab = 'groups' | 'groupComparison' | 'retirement' | 'attendance' | 'expenses';
type AttendanceView = 'senators' | 'groups' | 'provinces';
type RetirementSort = 'date' | 'served';
type AttendanceSort = 'missed' | 'rate' | 'present' | 'illness' | 'leave' | 'business';

function yearFromValue(value: string) {
  const match = value.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : 0;
}

function dateFromValue(value: string) {
  if (!value) return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;
  const year = yearFromValue(value);
  return year ? new Date(year, 0, 1) : null;
}

function daysUntilDate(date: Date | null) {
  if (!date) return undefined;
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.ceil((date.getTime() - startOfToday) / 86_400_000);
}

function timeToEventLabel(days?: number) {
  if (days === undefined) return '';
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'today';
  if (days < 60) return `in ${days} day${days === 1 ? '' : 's'}`;
  const months = Math.round(days / 30);
  if (months < 24) return `in ${months} month${months === 1 ? '' : 's'}`;
  const years = Math.round(months / 12);
  return `in ${years} year${years === 1 ? '' : 's'}`;
}

function urgencyClass(days?: number) {
  if (days === undefined) return 'unknown';
  if (days <= 30) return 'critical';
  if (days <= 183) return 'soon';
  if (days <= 365) return 'year';
  return 'later';
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

function numberValue(value: unknown) {
  return Number(value || 0);
}

function attendanceStats(row: SenStatsAttendanceDocument) {
  const sittingDays = numberValue(row.sittingDays);
  const present = numberValue(row.present);
  const business = numberValue(row.otherPublicBusiness);
  const illness = numberValue(row.illness);
  const leave = numberValue(row.leave);
  const missed = Math.max(sittingDays - present - business, illness + leave, 0);
  const rate = sittingDays ? Math.round((present / sittingDays) * 100) : 0;
  return { sittingDays, present, business, illness, leave, missed, rate };
}

function aggregateAttendance<T extends string>(rows: Array<SenStatsAttendanceDocument & { id: string }>, keyForRow: (row: SenStatsAttendanceDocument & { id: string }) => T) {
  const totals = new Map<T, { key: T; sittingDays: number; present: number; business: number; illness: number; leave: number; missed: number; count: number }>();
  rows.forEach((row) => {
    const key = keyForRow(row);
    const stats = attendanceStats(row);
    const current = totals.get(key) ?? { key, sittingDays: 0, present: 0, business: 0, illness: 0, leave: 0, missed: 0, count: 0 };
    current.sittingDays += stats.sittingDays;
    current.present += stats.present;
    current.business += stats.business;
    current.illness += stats.illness;
    current.leave += stats.leave;
    current.missed += stats.missed;
    current.count += 1;
    totals.set(key, current);
  });
  return Array.from(totals.values()).map((item) => ({ ...item, rate: item.sittingDays ? Math.round((item.present / item.sittingDays) * 100) : 0 })).sort((a, b) => a.rate - b.rate || b.missed - a.missed);
}

function attendanceRateClass(rate: number) {
  if (rate >= 80) return 'high';
  if (rate >= 60) return 'medium';
  return 'low';
}


function InfoTooltip({ label }: { label: string }) {
  return <span className="info-tooltip" tabIndex={0} aria-label={label}>i<span role="tooltip">{label}</span></span>;
}

function AttendanceRateCell({ rate }: { rate: number }) {
  return <span className={`attendance-rate-cell ${attendanceRateClass(rate)}`}><i style={{ width: `${Math.max(rate, 4)}%` }} aria-hidden="true" /><b>{rate}%</b></span>;
}

function AttendanceSortButton({ sort, activeSort, onSort, children, title, average }: { sort: AttendanceSort; activeSort: AttendanceSort; onSort: (sort: AttendanceSort) => void; children: string; title?: string; average?: number }) {
  return <button type="button" className={`attendance-sort-button ${activeSort === sort ? 'active' : ''}`} onClick={() => onSort(sort)} title={title}>
    <span>{children}{title && <i aria-hidden="true">i</i>}</span>{average !== undefined && <small>Avg {average}%</small>}
  </button>;
}

export function SenStatsDashboardsView({ senators, attendance, expenses, selectedSenator, onSelectSenator, expensesLoading, recentlyChangedSenatorIds, syncedAttendanceCount }: { senators: SenStatsSenatorDocument[]; attendance: Array<SenStatsAttendanceDocument & { id: string }>; expenses: Array<SenStatsExpenseDocument & { id: string }>; selectedSenator?: SenStatsSenatorDocument; onSelectSenator: (id: string) => void; expensesLoading: boolean; recentlyChangedSenatorIds: Set<string>; syncedAttendanceCount: number }) {
  const [activeDashboard, setActiveDashboard] = useState<DashboardTab>('groups');
  const [retirementSort, setRetirementSort] = useState<RetirementSort>('date');
  const [attendanceView, setAttendanceView] = useState<AttendanceView>('senators');
  const [attendanceSort, setAttendanceSort] = useState<AttendanceSort>('missed');
  const [forecastMonths, setForecastMonths] = useState(24);
  const groupedSenators = useMemo(() => Array.from(senators.reduce((map, senator) => { const group = senator.party || 'Unknown'; return map.set(group, [...(map.get(group) ?? []), senator]); }, new Map<string, SenStatsSenatorDocument[]>())).sort((a, b) => b[1].length - a[1].length).map(([group, groupSenators]) => ({ group, senators: groupSenators })), [senators]);
  const groups = useMemo(() => groupedSenators.map(({ group, senators: groupSenators }) => [group, groupSenators.length] as [string, number]), [groupedSenators]);
  const retirementRows = useMemo(() => senators.map((senator) => {
    const retirementDate = detailValue(senator, ['retirementDate', 'retirement-date', 'mandatory-retirement-date', 'retirement']);
    const appointedDate = detailValue(senator, ['nominatedDate', 'appointed-date', 'appointedDate', 'summoned-to-the-senate', 'date-of-appointment']);
    const retirementYear = yearFromValue(retirementDate);
    const appointedYear = yearFromValue(appointedDate);
    const parsedRetirementDate = dateFromValue(retirementDate);
    const daysUntilRetirement = daysUntilDate(parsedRetirementDate);
    return { senator, retirementDate, appointedDate, age: senatorAge(retirementDate), yearsServed: appointedYear ? Math.max(new Date().getFullYear() - appointedYear, 0) : 0, retirementYear: retirementYear || 9999, retirementTimestamp: parsedRetirementDate?.getTime() ?? Number.MAX_SAFE_INTEGER, daysUntilRetirement };
  }).sort((a, b) => retirementSort === 'served' ? b.yearsServed - a.yearsServed : a.retirementTimestamp - b.retirementTimestamp), [retirementSort, senators]);
  const retirementSummary = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const upcomingRows = retirementRows.filter((row) => row.daysUntilRetirement === undefined || row.daysUntilRetirement >= 0);
    const nextFive = upcomingRows.slice(0, 5);
    const groupBalance = Array.from(nextFive.reduce((counts, row) => {
      const label = groupLabel(row.senator.party || 'Unknown');
      counts.set(label, (counts.get(label) || 0) + 1);
      return counts;
    }, new Map<string, number>())).map(([label, count]) => `${count} ${label}`).join(', ');
    const tenureRows = upcomingRows.filter((row) => row.yearsServed > 0);
    const averageTenure = tenureRows.length ? Math.round((tenureRows.reduce((sum, row) => sum + row.yearsServed, 0) / tenureRows.length) * 10) / 10 : 0;
    return {
      thisQuarter: upcomingRows.filter((row) => row.daysUntilRetirement !== undefined && row.daysUntilRetirement <= 92).length,
      thisYear: upcomingRows.filter((row) => row.retirementYear === currentYear).length,
      averageTenure,
      groupBalance,
    };
  }, [retirementRows]);
  const senatorsById = useMemo(() => new Map(senators.map((senator) => [senator.id, senator])), [senators]);
  const attendanceRows = useMemo(() => [...attendance].sort((a, b) => {
    const aStats = attendanceStats(a);
    const bStats = attendanceStats(b);
    if (attendanceSort === 'rate') return aStats.rate - bStats.rate || bStats.missed - aStats.missed;
    if (attendanceSort === 'present') return bStats.present - aStats.present;
    if (attendanceSort === 'illness') return bStats.illness - aStats.illness;
    if (attendanceSort === 'leave') return bStats.leave - aStats.leave;
    if (attendanceSort === 'business') return bStats.business - aStats.business;
    return bStats.missed - aStats.missed || aStats.rate - bStats.rate;
  }), [attendance, attendanceSort]);
  const senateAttendanceAverage = useMemo(() => {
    const totals = attendance.reduce((sum, row) => {
      const stats = attendanceStats(row);
      return { present: sum.present + stats.present, sittingDays: sum.sittingDays + stats.sittingDays };
    }, { present: 0, sittingDays: 0 });
    return totals.sittingDays ? Math.round((totals.present / totals.sittingDays) * 100) : 0;
  }, [attendance]);
  const attendanceByGroup = useMemo(() => aggregateAttendance(attendance, (row) => row.party || 'Unknown'), [attendance]);
  const attendanceByProvince = useMemo(() => aggregateAttendance(attendance, (row) => senatorsById.get(row.senatorId || '')?.province || 'Unknown'), [attendance, senatorsById]);

  const groupComparisonRows = useMemo(() => groupedSenators.map(({ group, senators: groupSenators }) => {
    const senatorIds = new Set(groupSenators.map((senator) => senator.id));
    const groupAttendance = attendance.filter((row) => row.senatorId && senatorIds.has(row.senatorId));
    const attendanceTotals = groupAttendance.reduce((sum, row) => {
      const stats = attendanceStats(row);
      return { present: sum.present + stats.present, sittingDays: sum.sittingDays + stats.sittingDays, missed: sum.missed + stats.missed };
    }, { present: 0, sittingDays: 0, missed: 0 });
    const averageAttendance = attendanceTotals.sittingDays ? Math.round((attendanceTotals.present / attendanceTotals.sittingDays) * 100) : 0;
    const upcomingRetirements = retirementRows.filter((row) => row.senator.party === group && row.daysUntilRetirement !== undefined && row.daysUntilRetirement >= 0 && row.daysUntilRetirement <= 730).length;
    return { group, count: groupSenators.length, averageAttendance, missed: attendanceTotals.missed, upcomingRetirements };
  }).sort((a, b) => b.averageAttendance - a.averageAttendance || b.upcomingRetirements - a.upcomingRetirements), [attendance, groupedSenators, retirementRows]);
  const maxUpcomingRetirements = Math.max(...groupComparisonRows.map((row) => row.upcomingRetirements), 1);
  const forecastRows = useMemo(() => {
    const cutoff = forecastMonths * 30;
    const retiringIds = new Set(retirementRows.filter((row) => row.daysUntilRetirement !== undefined && row.daysUntilRetirement >= 0 && row.daysUntilRetirement <= cutoff).map((row) => row.senator.id));
    return groupedSenators.map(({ group, senators: groupSenators }) => {
      const retiring = groupSenators.filter((senator) => retiringIds.has(senator.id)).length;
      return { group, current: groupSenators.length, retiring, projected: Math.max(groupSenators.length - retiring, 0) };
    }).sort((a, b) => b.current - a.current);
  }, [forecastMonths, groupedSenators, retirementRows]);

  return <section className="dashboards-view" aria-label="Quorum dashboards">
    <div className="senstats-tabs nested-tabs" role="tablist" aria-label="Dashboards">
      {(['groups', 'groupComparison', 'expenses', 'retirement', 'attendance'] as DashboardTab[]).map((tab) => <button key={tab} type="button" className={activeDashboard === tab ? 'active' : ''} onClick={() => setActiveDashboard(tab)}>{tab === 'groups' ? 'Groups' : tab === 'groupComparison' ? 'Group Comparison' : tab === 'expenses' ? 'Expenses' : tab === 'retirement' ? 'Retirement' : 'Attendance'}</button>)}
    </div>

    {activeDashboard === 'groups' && <>
      <div className="dashboard-card-grid">
        {groups.map(([group, count]) => <article key={group} className={`dashboard-metric-card ${groupClassName(group)}`}><span>{groupLabel(group)}</span><strong>{count}</strong><small>{Math.round((count / Math.max(senators.length, 1)) * 100)}% of current senators</small></article>)}
      </div>
      <SenStatsGroupsView groups={groupedSenators} recentlyChangedSenatorIds={recentlyChangedSenatorIds} onSelectSenator={onSelectSenator} />
    </>}


    {activeDashboard === 'groupComparison' && <div className="source-card source-wide"><div className="source-heading"><span>Group comparison</span><strong>Attendance and retirement pressure by group <InfoTooltip label="Compares group size, average attendance, missed sitting days, and mandatory retirements expected within 24 months." /></strong><small className="muted">Average attendance is calculated from synced attendance rows; retirement pressure counts mandatory retirements in the next 24 months.</small></div><div className="dashboard-table group-comparison-table" role="table" aria-label="Group comparison dashboard"><div role="row" className="source-table-head"><span>Group</span><span>Senators</span><span>Avg attendance</span><span>Upcoming retirements</span><span>Missed days</span></div>{groupComparisonRows.map((row) => <div role="row" key={row.group} className={groupClassName(row.group)}><strong>{groupLabel(row.group)}</strong><span>{row.count}</span><span><AttendanceRateCell rate={row.averageAttendance} /></span><span className="comparison-bar-cell"><b>{row.upcomingRetirements}</b><i style={{ width: `${Math.max((row.upcomingRetirements / maxUpcomingRetirements) * 100, row.upcomingRetirements ? 8 : 0)}%` }} aria-hidden="true" /></span><span>{row.missed}</span></div>)}</div></div>}

    {activeDashboard === 'expenses' && <div className="dashboard-info-wrap"><InfoTooltip label="Expense dashboards use the separate proactive disclosure scrape, so values may lag the daily roster sync. Clicking a senator shows expense details first, with profile available by button." /><SenStatsExpensesDashboardView senators={senators} expenses={expenses} selectedSenator={selectedSenator} onSelectSenator={onSelectSenator} loading={expensesLoading} /></div>}

    {activeDashboard === 'retirement' && <div className="source-card source-wide"><div className="source-heading"><span>Retirement</span><strong>Upcoming retirements and tenure <InfoTooltip label="Mandatory retirement dates are modeled from synced retirement fields; use the slider to forecast group composition up to 24 months ahead." /></strong><select value={retirementSort} onChange={(event) => setRetirementSort(event.target.value as RetirementSort)}><option value="date">Retiring soonest</option><option value="served">Longest served</option></select></div><div className="retirement-forecast-control"><label><span>Forecast composition over {forecastMonths} months</span><input type="range" min="1" max="24" value={forecastMonths} onChange={(event) => setForecastMonths(Number(event.target.value))} /></label><div className="forecast-bars">{forecastRows.map((row) => <div key={row.group} className={groupClassName(row.group)}><span>{groupLabel(row.group)}</span><b>{row.projected}</b><i style={{ width: `${Math.max((row.projected / Math.max(row.current, 1)) * 100, 4)}%` }} aria-hidden="true" /><small>{row.retiring ? `${row.retiring} retiring` : 'No mandatory retirements'}</small></div>)}</div></div><div className="retirement-summary-grid" aria-label="Retirement summary"><article><span>Retiring this quarter</span><strong>{retirementSummary.thisQuarter}</strong><small>Within 92 days</small></article><article><span>Retiring this year</span><strong>{retirementSummary.thisYear}</strong><small>{new Date().getFullYear()}</small></article><article><span>Average tenure retiring</span><strong>{retirementSummary.averageTenure || '—'}</strong><small>Years served</small></article><article className="wide"><span>Next 5 group balance</span><strong>{retirementSummary.groupBalance || 'Not enough data'}</strong><small>Based on soonest upcoming retirements</small></article></div><div className="dashboard-table retirement-table" role="table" aria-label="Senator retirement dashboard"><div role="row" className="source-table-head"><span>Name</span><span>Group</span><span>Retirement</span><span>Approx. age</span><span>Years served</span></div>{retirementRows.map(({ senator, retirementDate, appointedDate, age, yearsServed, daysUntilRetirement }) => <button type="button" role="row" key={senator.id} className={`dashboard-click-row ${groupClassName(senator.party)}`} onClick={() => onSelectSenator(senator.id)} title={appointedDate ? `Appointed ${appointedDate}` : 'Appointment date not synced'}><strong>{senator.name}</strong><em>{groupLabel(senator.party)}</em><span className={`retirement-date-cell ${urgencyClass(daysUntilRetirement)}`}><b>{retirementDate || 'Not synced'}</b>{retirementDate && <small>{timeToEventLabel(daysUntilRetirement)}</small>}</span><span>{age ?? '—'}</span><span>{yearsServed || '—'}</span></button>)}</div></div>}

    {activeDashboard === 'attendance' && <div className="source-card source-wide"><div className="source-heading"><span>Attendance</span><strong>Senators' Attendance and Activities on Sitting Days <InfoTooltip label="Attendance rates use present days divided by sitting days; public business, illness, and leave are shown separately for context." /></strong><select value={attendanceSort} onChange={(event) => setAttendanceSort(event.target.value as AttendanceSort)}><option value="missed">Most days missed</option><option value="rate">Lowest attendance rate</option><option value="present">Most present days</option><option value="illness">Most illness days</option><option value="leave">Most leave days</option><option value="business">Most public business</option></select><a href="https://sencanada.ca/en/attendance/" target="_blank" rel="noreferrer">Open source</a></div>{attendanceRows.length === 0 ? <p className="muted">{syncedAttendanceCount > 0 ? `${syncedAttendanceCount} attendance rows were reported by the latest sync, but the realtime listener did not return row documents. Check deployed Firestore rules for senstats_attendance reads.` : 'No attendance rows synced yet. The ingestion script reads the public attendance register and stores summary rows after the next sync.'}</p> : <>
      <div className="senstats-tabs nested-tabs attendance-view-tabs" role="tablist" aria-label="Attendance dashboard views">
        {(['senators', 'groups', 'provinces'] as AttendanceView[]).map((view) => <button key={view} type="button" className={attendanceView === view ? 'active' : ''} onClick={() => setAttendanceView(view)}>{view === 'senators' ? 'By senator' : view === 'groups' ? 'By group' : 'By province'}</button>)}
      </div>
      {attendanceView === 'senators' && <div className="dashboard-table attendance-table expanded" role="table" aria-label="Senator attendance dashboard"><div role="row" className="source-table-head attendance-head"><span>Name</span><span>Group</span><span>Province</span><AttendanceSortButton sort="rate" activeSort={attendanceSort} onSort={setAttendanceSort} average={senateAttendanceAverage}>Rate</AttendanceSortButton><AttendanceSortButton sort="present" activeSort={attendanceSort} onSort={setAttendanceSort}>Present</AttendanceSortButton><AttendanceSortButton sort="business" activeSort={attendanceSort} onSort={setAttendanceSort} title="Excused/Other: days spent on other public parliamentary business.">Public business</AttendanceSortButton><AttendanceSortButton sort="illness" activeSort={attendanceSort} onSort={setAttendanceSort} title="Excused/Other: sitting days recorded as illness.">Illness</AttendanceSortButton><AttendanceSortButton sort="leave" activeSort={attendanceSort} onSort={setAttendanceSort} title="Excused/Other: sitting days recorded as leave.">Leave</AttendanceSortButton><AttendanceSortButton sort="missed" activeSort={attendanceSort} onSort={setAttendanceSort} title="Unexcused/uncategorized days not counted as present or public business.">Missed</AttendanceSortButton></div>{attendanceRows.map((row) => { const stats = attendanceStats(row); const senator = senatorsById.get(row.senatorId || ''); return <button type="button" role="row" key={row.id} className={`dashboard-click-row ${groupClassName(row.party || '')}`} onClick={() => { if (senator) onSelectSenator(senator.id); }}><strong className="attendance-name-cell">{row.senatorName}</strong><em>{groupLabel(row.party || 'Unknown')}</em><span>{senator?.province || '—'}</span><AttendanceRateCell rate={stats.rate} /><span>{stats.present}/{stats.sittingDays}</span><span>{stats.business}</span><span>{stats.illness}</span><span>{stats.leave}</span><span>{stats.missed}</span></button>; })}</div>}
      {attendanceView === 'groups' && <div className="dashboard-table attendance-table aggregate" role="table" aria-label="Attendance by group"><div role="row" className="source-table-head"><span>Group</span><span>Rate</span><span>Senators</span><span>Present</span><span>Public business</span><span>Illness</span><span>Leave</span><span>Missed</span></div>{attendanceByGroup.map((item) => <div role="row" key={item.key} className={groupClassName(item.key)}><strong>{groupLabel(item.key)}</strong><span>{item.rate}%</span><span>{item.count}</span><span>{item.present}/{item.sittingDays}</span><span>{item.business}</span><span>{item.illness}</span><span>{item.leave}</span><span>{item.missed}</span></div>)}</div>}
      {attendanceView === 'provinces' && <div className="dashboard-table attendance-table aggregate" role="table" aria-label="Attendance by province"><div role="row" className="source-table-head"><span>Province</span><span>Rate</span><span>Senators</span><span>Present</span><span>Public business</span><span>Illness</span><span>Leave</span><span>Missed</span></div>{attendanceByProvince.map((item) => <div role="row" key={item.key}><strong>{item.key}</strong><span>{item.rate}%</span><span>{item.count}</span><span>{item.present}/{item.sittingDays}</span><span>{item.business}</span><span>{item.illness}</span><span>{item.leave}</span><span>{item.missed}</span></div>)}</div>}
    </>}</div>}
  </section>;
}
