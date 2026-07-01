import type { ScoredVehicle } from '../types';

interface CompareTrayProps {
  selectedVehicles: ScoredVehicle[];
  onCompareNow: () => void;
  onClear: () => void;
  onRemove: (vehicleId: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

function ArrowLeftIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5M8 10h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ArrowRightIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5M4 10h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function RemoveIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>;
}

function DragIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5h.01M13 5h.01M7 10h.01M13 10h.01M7 15h.01M13 15h.01" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>;
}

export function CompareTray({ selectedVehicles, onCompareNow, onClear, onRemove, onReorder }: CompareTrayProps) {
  return (
    <aside className="compare-tray" aria-label="Selected vehicles for comparison">
      <div className="compare-tray-header"><div><strong>Compare tray</strong><span>{selectedVehicles.length}/4 selected</span></div><div className="compare-tray-actions"><button type="button" onClick={onCompareNow} disabled={selectedVehicles.length === 0}>Compare now</button><button type="button" onClick={onClear}>Clear all</button></div></div>
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
            <span className="drag-handle"><DragIcon /></span>
            {vehicle.imageUrl && <img src={vehicle.imageUrl} alt="" />}
            <span className="compare-tray-copy"><strong>{vehicle.name}</strong><small>{vehicle.overallRecommendationScore}/100 match</small></span>
            <span className="compare-tray-buttons">
              <button type="button" onClick={() => onReorder(index, Math.max(index - 1, 0))} aria-label={`Move ${vehicle.name} left`}><ArrowLeftIcon /></button>
              <button type="button" onClick={() => onReorder(index, Math.min(index + 1, selectedVehicles.length - 1))} aria-label={`Move ${vehicle.name} right`}><ArrowRightIcon /></button>
              <button className="remove" type="button" onClick={() => onRemove(vehicle.id)} aria-label={`Remove ${vehicle.name}`}><RemoveIcon /></button>
            </span>
          </article>
        ))}
      </div>
    </aside>
  );
}
