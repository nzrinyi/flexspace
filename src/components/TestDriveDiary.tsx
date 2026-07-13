import { FormEvent, useMemo, useState, type CSSProperties } from 'react';
import type { ScoredVehicle, TestDriveEntry } from '../types';
import { checklistCompletion } from '../hooks/useTestDriveDiary';

export function TestDriveDiary({ vehicles, entries, onSaveEntry }: { vehicles: ScoredVehicle[]; entries: TestDriveEntry[]; onSaveEntry: (entry: TestDriveEntry) => void }) {
  const [draft, setDraft] = useState<TestDriveEntry>(defaultDiaryDraft(vehicles[0]?.id ?? ''));
  const groupedEntries = useMemo(() => vehicles.map((vehicle) => ({ vehicle, entries: entries.filter((entry) => entry.vehicleId === vehicle.id) })).filter((group) => group.entries.length > 0), [entries, vehicles]);

  function addEntry(event: FormEvent) {
    event.preventDefault();
    onSaveEntry(draft);
    setDraft({ ...defaultDiaryDraft(draft.vehicleId), dealer: draft.dealer });
  }

  return (
    <section className="card stack">
      <div className="section-heading"><p className="eyebrow">Test drive timeline</p><span>{entries.length} entries</span></div>
      <form className="diary-form diary-panel" onSubmit={addEntry}>
        <select value={draft.vehicleId} onChange={(event) => setDraft({ ...draft, vehicleId: event.target.value })}>{vehicles.map((vehicle) => <option value={vehicle.id} key={vehicle.id}>{vehicle.name}</option>)}</select>
        <select value={draft.status ?? 'Planned'} onChange={(event) => setDraft({ ...draft, status: event.target.value as TestDriveEntry['status'] })}><option>Planned</option><option>Completed</option></select>
        <input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} />
        <input type="time" value={draft.appointmentTime} onChange={(event) => setDraft({ ...draft, appointmentTime: event.target.value })} />
        <input type="date" value={draft.reminderDate} onChange={(event) => setDraft({ ...draft, reminderDate: event.target.value })} />
        <input placeholder="Dealer / location" value={draft.dealer} onChange={(event) => setDraft({ ...draft, dealer: event.target.value })} />
        <input placeholder="Photo URLs, comma-separated" value={(draft.photoUrls ?? []).join(', ')} onChange={(event) => setDraft({ ...draft, photoUrls: event.target.value.split(',').map((url) => url.trim()).filter(Boolean) })} />
        <textarea placeholder="Driving notes, kid comfort, road noise..." value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
        {(['carSeatFits', 'strollerFits', 'doorsOpen90', 'passengerLegroom', 'cargoFloorWorks', 'winterTireQuote', 'outTheDoorQuote', 'prepaymentRules'] as const).map((key) => <label className="check" key={key}><input type="checkbox" checked={Boolean(draft[key])} onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })} /> {checklistLabel(key)}</label>)}
        <label>Winter confidence {draft.winterConfidence}<input type="range" min="1" max="10" value={draft.winterConfidence} onChange={(event) => setDraft({ ...draft, winterConfidence: Number(event.target.value) })} /></label>
        <label>Partner rating {draft.partnerRating}<input type="range" min="1" max="10" value={draft.partnerRating} onChange={(event) => setDraft({ ...draft, partnerRating: Number(event.target.value) })} /></label>
        <button type="submit">Save diary entry</button>
      </form>

      <div className="timeline-list">
        {groupedEntries.length === 0 && <p className="muted">No test drives yet. Book one, add a reminder, then mark it complete after the drive.</p>}
        {groupedEntries.map(({ vehicle, entries: vehicleEntries }) => {
          const bestSeatEntry = vehicleEntries.filter((entry) => entry.carSeatFits).sort((a, b) => b.partnerRating - a.partnerRating)[0];
          return <section className="timeline-group" key={vehicle.id}><div className="timeline-heading"><strong>{vehicle.name}</strong>{bestSeatEntry && <span>Best child-seat fit so far: {bestSeatEntry.dealer || bestSeatEntry.date}</span>}</div>{vehicleEntries.map((entry, index) => <TimelineEntry entry={entry} key={entry.id ?? `${entry.vehicleId}-${entry.date}-${index}`} />)}</section>;
        })}
      </div>
    </section>
  );
}

function TimelineEntry({ entry }: { entry: TestDriveEntry }) {
  const completion = checklistCompletion(entry);
  return <article className={`timeline-card status-${(entry.status ?? 'Planned').toLowerCase()}`}><div className="timeline-date"><strong>{entry.date}</strong><span>{entry.appointmentTime || 'Time TBD'}</span></div><div className="timeline-body"><div className="timeline-title"><strong>{entry.dealer || 'Dealer/location TBD'}</strong><span>{entry.status ?? 'Planned'}</span></div><p>{entry.notes || 'No notes yet.'}</p><div className="photo-strip">{(entry.photoUrls ?? []).length === 0 ? <span>Photo slot ready</span> : entry.photoUrls?.map((url) => <img src={url} alt="Test drive" key={url} />)}</div><div className="diary-chips"><span>{entry.carSeatFits ? '✓' : '○'} Car seat</span><span>{entry.strollerFits ? '✓' : '○'} Stroller</span><span>{entry.doorsOpen90 ? '✓' : '○'} Doors 90°</span><span>Winter {entry.winterConfidence}/10</span><span>Partner {entry.partnerRating}/10</span>{entry.reminderDate && <span>Reminder {entry.reminderDate}</span>}</div></div><div className="progress-ring" style={{ '--progress': `${completion}%` } as CSSProperties}><strong>{completion}%</strong><span>checklist</span></div></article>;
}

function defaultDiaryDraft(vehicleId: string): TestDriveEntry { return { vehicleId, date: new Date().toISOString().slice(0, 10), appointmentTime: '', reminderDate: '', dealer: '', notes: '', carSeatFits: false, strollerFits: false, doorsOpen90: false, passengerLegroom: false, cargoFloorWorks: false, winterTireQuote: false, outTheDoorQuote: false, prepaymentRules: false, winterConfidence: 5, partnerRating: 5, photoUrls: [], status: 'Planned' }; }
function checklistLabel(key: keyof Pick<TestDriveEntry, 'carSeatFits' | 'strollerFits' | 'doorsOpen90' | 'passengerLegroom' | 'cargoFloorWorks' | 'winterTireQuote' | 'outTheDoorQuote' | 'prepaymentRules'>) { return ({ carSeatFits: 'Car seat fit checked', strollerFits: 'Stroller fit checked', doorsOpen90: 'Rear doors open wide', passengerLegroom: 'Passenger legroom with car seat', cargoFloorWorks: 'Cargo floor works for stroller', winterTireQuote: 'Asked winter tire pricing', outTheDoorQuote: 'Got out-the-door quote', prepaymentRules: 'Asked prepayment rules' })[key]; }
