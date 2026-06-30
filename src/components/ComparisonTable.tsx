import type { DealQuoteDocument, ProfileName, ScoredVehicle, TestDriveEntry, VehicleNoteDocument, VehicleStage } from '../types';
import { quoteNetPrice } from '../hooks/useDealQuotes';

const stageOptions: VehicleStage[] = ['Browsing', 'Shortlisted', 'Test drive booked', 'Test driven', 'Quote received', 'Finalist', 'Rejected', 'Winner'];

interface ComparisonTableProps {
  vehicles: ScoredVehicle[];
  favoritesByProfile: Record<ProfileName, string[]>;
  notes: Record<string, VehicleNoteDocument>;
  quotes: DealQuoteDocument[];
  entries: TestDriveEntry[];
  onStageChange: (vehicleId: string, stage: VehicleStage) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

export function ComparisonTable({ vehicles, favoritesByProfile, notes, quotes, entries, onStageChange, onReorder }: ComparisonTableProps) {
  const rows = ['MSRP', 'Monthly', 'Overall', 'Confidence', 'Test drive', 'Deal', 'Seats', 'Cargo', 'Drive', 'Powertrain', 'Emily', 'Nick', 'Best quote', 'Diary entries'] as const;

  return (
    <section className="card stack">
      <div className="section-heading"><p className="eyebrow">Side-by-side comparison</p><span>Drag headers or use arrows to reorder columns</span></div>
      <div className="comparison-table fixed-compare" style={{ gridTemplateColumns: `minmax(130px, .7fr) repeat(${Math.max(vehicles.length, 1)}, minmax(180px, 1fr))` }}>
        <div className="compare-head">Metric</div>
        {vehicles.map((vehicle, index) => (
          <div
            className="compare-head"
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
            {vehicle.imageUrl && <img className="vehicle-photo" src={vehicle.imageUrl} alt={`${vehicle.name} thumbnail`} />}
            <strong>{vehicle.name}</strong>
            <div className="column-actions"><button type="button" onClick={() => onReorder(index, Math.max(index - 1, 0))}>←</button><button type="button" onClick={() => onReorder(index, Math.min(index + 1, vehicles.length - 1))}>→</button></div>
            <select value={notes[vehicle.id]?.stage ?? 'Browsing'} onChange={(event) => onStageChange(vehicle.id, event.target.value as VehicleStage)}>{stageOptions.map((stage) => <option key={stage}>{stage}</option>)}</select>
          </div>
        ))}
        {rows.map((row) => <ComparisonRow key={row} row={row} vehicles={vehicles} favoritesByProfile={favoritesByProfile} notes={notes} quotes={quotes} entries={entries} />)}
      </div>
    </section>
  );
}

function ComparisonRow({ row, vehicles, favoritesByProfile, notes, quotes, entries }: { row: string; vehicles: ScoredVehicle[]; favoritesByProfile: Record<ProfileName, string[]>; notes: Record<string, VehicleNoteDocument>; quotes: DealQuoteDocument[]; entries: TestDriveEntry[] }) {
  return <><div className="compare-label">{row}</div>{vehicles.map((vehicle) => <div key={`${row}-${vehicle.id}`}>{comparisonValue(row, vehicle, favoritesByProfile, notes, quotes, entries)}</div>)}</>;
}

function comparisonValue(row: string, vehicle: ScoredVehicle, favoritesByProfile: Record<ProfileName, string[]>, notes: Record<string, VehicleNoteDocument>, quotes: DealQuoteDocument[], entries: TestDriveEntry[]) {
  const note = notes[vehicle.id] ?? { reactions: { Emily: 'Unrated', Nick: 'Unrated' } };
  const bestQuote = quotes.filter((quote) => quote.vehicleId === vehicle.id).sort((a, b) => quoteNetPrice(a) - quoteNetPrice(b))[0];
  const diaryCount = entries.filter((entry) => entry.vehicleId === vehicle.id).length;
  const values: Record<string, string> = {
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
