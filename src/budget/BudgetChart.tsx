import { useEffect, useRef, useState } from "react";
import { displayDate, money } from "./model";
export function BudgetChart({
  points,
  currency,
  reserve,
}: {
  points: Array<{ date: string; cents: number }>;
  currency: string;
  reserve: number;
}) {
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [points.length]);
  const container = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(880);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) =>
      setMeasuredWidth(entries[0].contentRect.width),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const width = Math.max(300, measuredWidth),
    height = 240,
    left = 78,
    right = 16,
    top = 22,
    bottom = 34;
  const rawMin = Math.min(...points.map((p) => p.cents), 0, reserve),
    rawMax = Math.max(...points.map((p) => p.cents), reserve, 10000);
  const pad = Math.max((rawMax - rawMin) * 0.08, 1000),
    min = rawMin - pad,
    max = rawMax + pad;
  const x = (i: number) =>
      left + (i / Math.max(points.length - 1, 1)) * (width - left - right),
    y = (n: number) =>
      top + ((max - n) / (max - min)) * (height - top - bottom);
  const line = points
      .map(
        (p, i) =>
          `${i ? "L" : "M"} ${x(i).toFixed(2)} ${y(p.cents).toFixed(2)}`,
      )
      .join(" "),
    area = `${line} L ${x(points.length - 1)} ${height - bottom} L ${left} ${height - bottom} Z`;
  const current = points[Math.min(selected, points.length - 1)];
  return (
    <div className="flow-forecast-chart" ref={container}>
      <div className="flow-chart-readout" aria-live="polite">
        <span>{displayDate(current.date, true)}</span>
        <strong className={current.cents < 0 ? "negative" : ""}>
          {money(current.cents, currency)}
        </strong>
        <small>Projected balance</small>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Projected daily balance from ${points[0].date} to ${points[points.length - 1].date}. Use the forecast day slider for exact values.`}
      >
        <defs>
          <linearGradient id="flow-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#397d78" stopOpacity=".2" />
            <stop offset="100%" stopColor="#397d78" stopOpacity=".01" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((t) => {
          const value = max - (max - min) * t;
          return (
            <g key={t}>
              <line
                x1={left}
                x2={width - right}
                y1={y(value)}
                y2={y(value)}
                stroke="#e6eaf0"
              />
              <text x={left - 12} y={y(value) + 4} textAnchor="end">
                {money(Math.round(value), currency)}
              </text>
            </g>
          );
        })}
        <line
          x1={left}
          x2={width - right}
          y1={y(reserve)}
          y2={y(reserve)}
          stroke="#b68a43"
          strokeDasharray="5 5"
        />
        <path d={area} fill="url(#flow-area)" />
        <path
          d={line}
          fill="none"
          stroke="#267870"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <line
          x1={x(selected)}
          x2={x(selected)}
          y1={top}
          y2={height - bottom}
          stroke="#637995"
          strokeDasharray="3 4"
        />
        <circle
          cx={x(selected)}
          cy={y(current.cents)}
          r="5"
          fill="#267870"
          stroke="white"
          strokeWidth="2"
        />
        {[0, Math.round((points.length - 1) / 2), points.length - 1].map(
          (i) => (
            <text
              key={i}
              x={x(i)}
              y={height - 8}
              textAnchor={
                i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"
              }
            >
              {displayDate(points[i].date, true)}
            </text>
          ),
        )}
      </svg>
      <label className="flow-chart-slider">
        Forecast day
        <input
          type="range"
          min="0"
          max={points.length - 1}
          value={selected}
          onChange={(e) => setSelected(+e.target.value)}
          aria-valuetext={`${displayDate(current.date)}: ${money(current.cents, currency)}`}
        />
      </label>
      <div className="flow-chart-key">
        <span>
          <i />
          Projected balance
        </span>
        <span>
          <i className="reserve" />
          Reserve floor
        </span>
        <small>
          Includes recorded future transactions, active recurring items and
          overdue items. Assumes no other spending.
        </small>
      </div>
    </div>
  );
}
