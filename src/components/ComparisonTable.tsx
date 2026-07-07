import type { DealQuoteDocument, ProfileName, ScoredVehicle, TestDriveEntry, VehicleNoteDocument, VehicleStage } from '../types';
import { quoteNetPrice } from '../hooks/useDealQuotes';

const stageOptions: VehicleStage[] = ['Browsing', 'Shortlisted', 'Test drive booked', 'Test driven', 'Quote received', 'Finalist', 'Rejected', 'Winner'];

const metricGroups = [
  { label: 'Financial Specs', rows: ['Actual / quote', 'MSRP', 'Monthly', 'Best quote'] },
  { label: 'Algorithm Scores', rows: ['Overall', 'Confidence', 'Test drive', 'Deal'] },
  { label: 'Family Evaluation', rows: ['Seats', 'Cargo', 'Drive', 'Powertrain', 'Emily', 'Nick', 'Diary entries'] },
] as const;

type ComparisonRowName = (typeof metricGroups)[number]['rows'][number];

interface ComparisonTableProps {
  vehicles: ScoredVehicle[];
  favoritesByProfile: Record<ProfileName, string[]>;
  notes: Record<string, VehicleNoteDocument>;
  quotes: DealQuoteDocument[];
  entries: TestDriveEntry[];
  onStageChange: (vehicleId: string, stage: VehicleStage) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onRemove: (vehicleId: string) => void;
}

function ArrowLeftIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5M8 10h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ArrowRightIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5M4 10h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function TrashIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 8v7M13 8v7M5 5h10M8 5l.5-1h3l.5 1M6 5l.5 12h7L14 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ChevronDownIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 7.5 10 12l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function ComparisonTable({ vehicles, favoritesByProfile, notes, quotes, entries, onStageChange, onReorder, onRemove }: ComparisonTableProps) {
  const bestScore = Math.max(...vehicles.map((vehicle) => vehicle.overallRecommendationScore), 0);
  const gridTemplateColumns = `minmax(135px, .62fr) repeat(${Math.max(vehicles.length, 1)}, minmax(210px, 1fr))`;

  return (
    <section className="card stack comparison-panel">
      <div className="section-heading"><div><p className="eyebrow">Side-by-side comparison</p><h2>Compare finalists at a glance.</h2></div><span>Drag headers or use arrows to reorder columns</span></div>
      <div className="comparison-grid" style={{ gridTemplateColumns }}>
        <div className="compare-grid-corner">Metric</div>
        {vehicles.map((vehicle, index) => {
          const isBestMatch = vehicle.overallRecommendationScore === bestScore;
          return (
            <div
              className={`compare-column-card compare-head-card ${isBestMatch ? 'best-match' : ''}`}
              key={vehicle.id}
              draggable
              onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const fromIndex = Number(event.dataTransfer.getData('text/plain'));
                if (!Number.isNaN(fromIndex)) onReorder(fromIndex, index);
              }}
            >
              {isBestMatch && <span className="best-match-badge">Best Match</span>}
              <div className="compare-column-actions">
                <button type="button" onClick={() => onReorder(index, Math.max(index - 1, 0))} aria-label={`Move ${vehicle.name} left`}><ArrowLeftIcon /></button>
                <button type="button" onClick={() => onReorder(index, Math.min(index + 1, vehicles.length - 1))} aria-label={`Move ${vehicle.name} right`}><ArrowRightIcon /></button>
                <button className="remove" type="button" onClick={() => onRemove(vehicle.id)} aria-label={`Remove ${vehicle.name}`}><TrashIcon /></button>
              </div>
              {vehicle.imageUrl && <img className="vehicle-photo" src={vehicle.imageUrl} alt={`${vehicle.name} thumbnail`} />}
              <strong>{vehicle.name}</strong>
              <small>${actualVehiclePrice(vehicle, quotes).toLocaleString('en-CA')} actual / quote</small>
              <label className="stage-select"><span className="sr-only">Stage for {vehicle.name}</span><select value={notes[vehicle.id]?.stage ?? 'Browsing'} onChange={(event) => onStageChange(vehicle.id, event.target.value as VehicleStage)}>{stageOptions.map((stage) => <option key={stage}>{stage}</option>)}</select><ChevronDownIcon /></label>
            </div>
          );
        })}
        {metricGroups.map((group) => (
          <ComparisonMetricGroup key={group.label} group={group} vehicles={vehicles} favoritesByProfile={favoritesByProfile} notes={notes} quotes={quotes} entries={entries} bestScore={bestScore} />
        ))}
      </div>
    </section>
  );
}

function ComparisonMetricGroup({ group, vehicles, favoritesByProfile, notes, quotes, entries, bestScore }: { group: (typeof metricGroups)[number]; vehicles: ScoredVehicle[]; favoritesByProfile: Record<ProfileName, string[]>; notes: Record<string, VehicleNoteDocument>; quotes: DealQuoteDocument[]; entries: TestDriveEntry[]; bestScore: number }) {
  return <><div className="compare-category">{group.label}</div>{group.rows.map((row, rowIndex) => <ComparisonRow key={row} row={row} rowIndex={rowIndex} vehicles={vehicles} favoritesByProfile={favoritesByProfile} notes={notes} quotes={quotes} entries={entries} bestScore={bestScore} />)}</>;
}

function ComparisonRow({ row, rowIndex, vehicles, favoritesByProfile, notes, quotes, entries, bestScore }: { row: ComparisonRowName; rowIndex: number; vehicles: ScoredVehicle[]; favoritesByProfile: Record<ProfileName, string[]>; notes: Record<string, VehicleNoteDocument>; quotes: DealQuoteDocument[]; entries: TestDriveEntry[]; bestScore: number }) {
  return <><div className={`compare-label-card ${rowIndex % 2 ? 'alt' : ''}`}>{row}</div>{vehicles.map((vehicle) => <div className={`compare-value-card ${rowIndex % 2 ? 'alt' : ''} ${vehicle.overallRecommendationScore === bestScore ? 'best-match' : ''}`} key={`${row}-${vehicle.id}`}>{comparisonValue(row, vehicle, favoritesByProfile, notes, quotes, entries)}</div>)}</>;
}

function actualVehiclePrice(vehicle: ScoredVehicle, quotes: DealQuoteDocument[]) {
  const bestQuote = quotes.filter((quote) => quote.vehicleId === vehicle.id).sort((a, b) => quoteNetPrice(a) - quoteNetPrice(b))[0];
  return bestQuote ? quoteNetPrice(bestQuote) : Math.round((vehicle.msrp + 2495) * 1.13);
}

function comparisonValue(row: string, vehicle: ScoredVehicle, favoritesByProfile: Record<ProfileName, string[]>, notes: Record<string, VehicleNoteDocument>, quotes: DealQuoteDocument[], entries: TestDriveEntry[]) {
  const note = notes[vehicle.id] ?? { reactions: { Emily: 'Unrated', Nick: 'Unrated' } };
  const bestQuote = quotes.filter((quote) => quote.vehicleId === vehicle.id).sort((a, b) => quoteNetPrice(a) - quoteNetPrice(b))[0];
  const diaryCount = entries.filter((entry) => entry.vehicleId === vehicle.id).length;
  const values: Record<string, string> = {
    'Actual / quote': `$${actualVehiclePrice(vehicle, quotes).toLocaleString('en-CA')}`,
    MSRP: `$${vehicle.msrp.toLocaleString('en-CA')}`,
    Monthly: `$${estimateMonthlyPayment(vehicle).toLocaleString('en-CA')}`,
    Overall: `${vehicle.overallRecommendationScore}`,
    Confidence: `${vehicle.confidenceScore}`,
    'Test drive': `${vehicle.testDriveScore}`,
    Deal: `${vehicle.dealScore}`,
    Seats: `${vehicle.seats}`,
    Cargo: `${vehicle.cargoLitres} L`,
    Drive: vehicle.drivetrain,
    Powertrain: vehicle.powertrain,
    Emily: `${favoritesByProfile.Emily.includes(vehicle.id) ? '★ ' : ''}${note.reactions?.Emily ?? 'Unrated'}`,
    Nick: `${favoritesByProfile.Nick.includes(vehicle.id) ? '★ ' : ''}${note.reactions?.Nick ?? 'Unrated'}`,
    'Best quote': bestQuote ? `$${quoteNetPrice(bestQuote).toLocaleString('en-CA')}` : 'None',
    'Diary entries': `${diaryCount}`,
  };
  return values[row] ?? '';
}

function estimateMonthlyPayment(vehicle: ScoredVehicle) {
  const allIn = (vehicle.msrp + 2495) * 1.13;
  const principal = Math.max(allIn - 5000, 0);
  const monthlyRate = 0.0599 / 12;
  return Math.round((principal * monthlyRate) / (1 - (1 + monthlyRate) ** -60));
}
