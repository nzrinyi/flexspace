import { useMemo, useState } from 'react';
import type { SenStatsAttendanceDocument, SenStatsSenatorDocument } from '../../types';
import { SenStatsGroupsView } from './SenStatsGroupsView';
import { groupClassName, groupLabel } from './SenStatsHelpers';

type DashboardTab = 'groups' | 'retirement' | 'attendance';
type AttendanceView = 'senators' | 'groups' | 'provinces';
type RetirementSort = 'date' | 'served';
type AttendanceSort = 'missed' | 'rate' | 'illness' | 'leave' | 'business';

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

export function SenStatsDashboardsView({ senators, attendance, recentlyChangedSenatorIds, syncedAttendanceCount }: { senators: SenStatsSenatorDocument[]; attendance: Array<SenStatsAttendanceDocument & { id: string }>; recentlyChangedSenatorIds: Set<string>; syncedAttendanceCount: number }) {
  const [activeDashboard, setActiveDashboard] = useState<DashboardTab>('groups');
  const [retirementSort, setRetirementSort] = useState<RetirementSort>('date');
  const [attendanceView, setAttendanceView] = useState<AttendanceView>('senators');
  const [attendanceSort, setAttendanceSort] = useState<AttendanceSort>('missed');
  const groupedSenators = useMemo(() => Array.from(senators.reduce((map, senator) => { const group = senator.party || 'Unknown'; return map.set(group, [...(map.get(group) ?? []), senator]); }, new Map<string, SenStatsSenatorDocument[]>())).sort((a, b) => b[1].length - a[1].length).map(([group, groupSenators]) => ({ group, senators: groupSenators })), [senators]);
  const groups = useMemo(() => groupedSenators.map(({ group, senators: groupSenators }) => [group, groupSenators.length] as [string, number]), [groupedSenators]);
  const retirementRows = useMemo(() => senators.map((senator) => {
    const retirementDate = detailValue(senator, ['retirementDate', 'retirement-date', 'mandatory-retirement-date', 'retirement']);
    const appointedDate = detailValue(senator, ['nominatedDate', 'appointed-date', 'appointedDate', 'summoned-to-the-senate', 'date-of-appointment']);
    const retirementYear = yearFromValue(retirementDate);
    const appointedYear = yearFromValue(appointedDate);
    return { senator, retirementDate, appointedDate, age: senatorAge(retirementDate), yearsServed: appointedYear ? Math.max(new Date().getFullYear() - appointedYear, 0) : 0, retirementYear: retirementYear || 9999 };
  }).sort((a, b) => retirementSort === 'served' ? b.yearsServed - a.yearsServed : a.retirementYear - b.retirementYear), [retirementSort, senators]);
  const senatorsById = useMemo(() => new Map(senators.map((senator) => [senator.id, senator])), [senators]);
  const attendanceRows = useMemo(() => [...attendance].sort((a, b) => {
    const aStats = attendanceStats(a);
    const bStats = attendanceStats(b);
    if (attendanceSort === 'rate') return aStats.rate - bStats.rate || bStats.missed - aStats.missed;
    if (attendanceSort === 'illness') return bStats.illness - aStats.illness;
    if (attendanceSort === 'leave') return bStats.leave - aStats.leave;
    if (attendanceSort === 'business') return bStats.business - aStats.business;
    return bStats.missed - aStats.missed || aStats.rate - bStats.rate;
  }), [attendance, attendanceSort]);
  const attendanceByGroup = useMemo(() => aggregateAttendance(attendance, (row) => row.party || 'Unknown'), [attendance]);
  const attendanceByProvince = useMemo(() => aggregateAttendance(attendance, (row) => senatorsById.get(row.senatorId || '')?.province || 'Unknown'), [attendance, senatorsById]);

  return <section className="dashboards-view" aria-label="SenStats dashboards">
    <div className="dashboard-overview-banner">
      <span>Dashboards</span>
      <strong>Group counts, retirement order, and attendance in one place</strong>
      <small>Use the nested tabs below to switch between the three dashboard views.</small>
    </div>
    <div className="senstats-tabs nested-tabs" role="tablist" aria-label="Dashboards">
      {(['groups', 'retirement', 'attendance'] as DashboardTab[]).map((tab) => <button key={tab} type="button" className={activeDashboard === tab ? 'active' : ''} onClick={() => setActiveDashboard(tab)}>{tab === 'groups' ? 'Groups' : tab === 'retirement' ? 'Retirement' : 'Attendance'}</button>)}
    </div>

    {activeDashboard === 'groups' && <>
      <div className="dashboard-card-grid">
        {groups.map(([group, count]) => <article key={group} className={`dashboard-metric-card ${groupClassName(group)}`}><span>{groupLabel(group)}</span><strong>{count}</strong><small>{Math.round((count / Math.max(senators.length, 1)) * 100)}% of current senators</small></article>)}
      </div>
      <SenStatsGroupsView groups={groupedSenators} recentlyChangedSenatorIds={recentlyChangedSenatorIds} />
    </>}

    {activeDashboard === 'retirement' && <div className="source-card source-wide"><div className="source-heading"><span>Retirement</span><strong>Upcoming retirements and tenure</strong><select value={retirementSort} onChange={(event) => setRetirementSort(event.target.value as RetirementSort)}><option value="date">Retiring soonest</option><option value="served">Longest served</option></select></div><div className="dashboard-table" role="table" aria-label="Senator retirement dashboard"><div role="row" className="source-table-head"><span>Name</span><span>Group</span><span>Retirement</span><span>Approx. age</span><span>Years served</span></div>{retirementRows.map(({ senator, retirementDate, age, yearsServed }) => <div role="row" key={senator.id} className={groupClassName(senator.party)}><strong>{senator.name}</strong><em>{groupLabel(senator.party)}</em><span>{retirementDate || 'Not synced'}</span><span>{age ?? '—'}</span><span>{yearsServed || '—'}</span></div>)}</div></div>}

    {activeDashboard === 'attendance' && <div className="source-card source-wide"><div className="source-heading"><span>Attendance</span><strong>Senators' Attendance and Activities on Sitting Days</strong><select value={attendanceSort} onChange={(event) => setAttendanceSort(event.target.value as AttendanceSort)}><option value="missed">Most days missed</option><option value="rate">Lowest attendance rate</option><option value="illness">Most illness days</option><option value="leave">Most leave days</option><option value="business">Most public business</option></select><a href="https://sencanada.ca/en/attendance/" target="_blank" rel="noreferrer">Open source</a></div>{attendanceRows.length === 0 ? <p className="muted">{syncedAttendanceCount > 0 ? `${syncedAttendanceCount} attendance rows were reported by the latest sync, but the realtime listener did not return row documents. Check deployed Firestore rules for senstats_attendance reads.` : 'No attendance rows synced yet. The ingestion script reads the public attendance register and stores summary rows after the next sync.'}</p> : <>
      <div className="senstats-tabs nested-tabs attendance-view-tabs" role="tablist" aria-label="Attendance dashboard views">
        {(['senators', 'groups', 'provinces'] as AttendanceView[]).map((view) => <button key={view} type="button" className={attendanceView === view ? 'active' : ''} onClick={() => setAttendanceView(view)}>{view === 'senators' ? 'By senator' : view === 'groups' ? 'By group' : 'By province'}</button>)}
      </div>
      {attendanceView === 'senators' && <div className="dashboard-table attendance-table expanded" role="table" aria-label="Senator attendance dashboard"><div role="row" className="source-table-head"><span>Name</span><span>Group</span><span>Province</span><span>Rate</span><span>Present</span><span>Public business</span><span>Illness</span><span>Leave</span><span>Missed</span></div>{attendanceRows.map((row) => { const stats = attendanceStats(row); const senator = senatorsById.get(row.senatorId || ''); return <div role="row" key={row.id} className={groupClassName(row.party || '')}><strong>{row.senatorName}</strong><em>{groupLabel(row.party || 'Unknown')}</em><span>{senator?.province || '—'}</span><span>{stats.rate}%</span><span>{stats.present}/{stats.sittingDays}</span><span>{stats.business}</span><span>{stats.illness}</span><span>{stats.leave}</span><span>{stats.missed}</span></div>; })}</div>}
      {attendanceView === 'groups' && <div className="dashboard-table attendance-table aggregate" role="table" aria-label="Attendance by group"><div role="row" className="source-table-head"><span>Group</span><span>Rate</span><span>Senators</span><span>Present</span><span>Public business</span><span>Illness</span><span>Leave</span><span>Missed</span></div>{attendanceByGroup.map((item) => <div role="row" key={item.key} className={groupClassName(item.key)}><strong>{groupLabel(item.key)}</strong><span>{item.rate}%</span><span>{item.count}</span><span>{item.present}/{item.sittingDays}</span><span>{item.business}</span><span>{item.illness}</span><span>{item.leave}</span><span>{item.missed}</span></div>)}</div>}
      {attendanceView === 'provinces' && <div className="dashboard-table attendance-table aggregate" role="table" aria-label="Attendance by province"><div role="row" className="source-table-head"><span>Province</span><span>Rate</span><span>Senators</span><span>Present</span><span>Public business</span><span>Illness</span><span>Leave</span><span>Missed</span></div>{attendanceByProvince.map((item) => <div role="row" key={item.key}><strong>{item.key}</strong><span>{item.rate}%</span><span>{item.count}</span><span>{item.present}/{item.sittingDays}</span><span>{item.business}</span><span>{item.illness}</span><span>{item.leave}</span><span>{item.missed}</span></div>)}</div>}
    </>}</div>}
  </section>;
}
