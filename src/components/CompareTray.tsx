import type { ScoredVehicle } from '../types';

interface CompareTrayProps {
  selectedVehicles: ScoredVehicle[];
  message?: string;
  onCompareNow: () => void;
  onClear: () => void;
  onRemove: (vehicleId: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

export function CompareTray({ selectedVehicles, message, onCompareNow, onClear, onRemove, onReorder }: CompareTrayProps) {
  return (
    <aside className="compare-tray" aria-label="Selected vehicles for comparison">
      <div><strong>Compare tray</strong><span>{selectedVehicles.length}/4 selected</span></div>
      <div className="compare-tray-list">
        {selectedVehicles.length === 0 && <span className="muted">Add up to four models to compare.</span>}
        {selectedVehicles.map((vehicle, index) => (
          <article
            key={vehicle.id}
            className="compare-tray-item"
            draggable
            onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const fromIndex = Number(event.dataTransfer.getData('text/plain'));
              if (!Number.isNaN(fromIndex)) onReorder(fromIndex, index);
            }}
          >
            {vehicle.imageUrl && <img src={vehicle.imageUrl} alt="" />}
            <span>{vehicle.name}</span>
            <button type="button" onClick={() => onReorder(index, Math.max(index - 1, 0))} aria-label={`Move ${vehicle.name} left`}>←</button>
            <button type="button" onClick={() => onReorder(index, Math.min(index + 1, selectedVehicles.length - 1))} aria-label={`Move ${vehicle.name} right`}>→</button>
            <button type="button" onClick={() => onRemove(vehicle.id)} aria-label={`Remove ${vehicle.name}`}>×</button>
          </article>
        ))}
      </div>
      {message && <p className="compare-message">{message}</p>}
      <div className="compare-tray-actions"><button type="button" onClick={onCompareNow} disabled={selectedVehicles.length === 0}>Compare now</button><button type="button" onClick={onClear}>Clear all</button></div>
    </aside>
  );
}
