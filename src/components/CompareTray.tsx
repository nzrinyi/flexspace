import type { ScoredVehicle } from '../types';

interface CompareTrayProps {
  selectedVehicles: ScoredVehicle[];
  onCompareNow: () => void;
  onClear: () => void;
  onRemove: (vehicleId: string) => void;
}

function RemoveIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>;
}

export function CompareTray({ selectedVehicles, onCompareNow, onClear, onRemove }: CompareTrayProps) {
  return (
    <aside className="compare-tray" aria-label="Selected vehicles for comparison">
      <div className="compare-tray-header"><div><strong>Compare tray</strong><span>{selectedVehicles.length}/4 selected</span></div><div className="compare-tray-actions"><button type="button" onClick={onCompareNow} disabled={selectedVehicles.length === 0}>Compare now</button><button type="button" onClick={onClear}>Clear all</button></div></div>
      <div className="compare-tray-list">
        {selectedVehicles.length === 0 && <span className="muted">Add up to four models to compare.</span>}
        {selectedVehicles.map((vehicle) => (
          <article key={vehicle.id} className="compare-tray-item">
            {vehicle.imageUrl && <img src={vehicle.imageUrl} alt="" />}
            <span className="compare-tray-copy"><strong>{vehicle.name}</strong><small>{vehicle.overallRecommendationScore}/100 match</small></span>
            <button className="remove compare-tray-remove" type="button" onClick={() => onRemove(vehicle.id)} aria-label={`Remove ${vehicle.name}`}><RemoveIcon /></button>
          </article>
        ))}
      </div>
    </aside>
  );
}
