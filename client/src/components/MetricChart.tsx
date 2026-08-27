import React, { useState } from 'react';

export interface ChartSeries {
  name: string;
  color: string;
  data: Array<{ timestamp: number; value: number }>;
}

interface MetricChartProps {
  title: string;
  unit: string;
  series: ChartSeries[];
  height?: number;
  valueFormatter?: (val: number) => string;
  maxY?: number;
  minY?: number;
}

export const MetricChart: React.FC<MetricChartProps> = ({
  title,
  unit,
  series,
  height = 180,
  valueFormatter,
  maxY: customMaxY,
  minY: customMinY = 0,
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Flatten timestamps to find bounds
  const allPoints = series.flatMap((s) => s.data);
  if (allPoints.length === 0) {
    return (
      <div className="p-4 rounded-3xl bg-surface-card border border-surface-border flex flex-col justify-between" style={{ minHeight: height + 60 }}>
        <h4 className="text-xs font-bold text-slate-300">{title}</h4>
        <div className="flex-1 flex items-center justify-center text-xs text-slate-500">
          No metrics available for selected range
        </div>
      </div>
    );
  }

  const timestamps = Array.from(new Set(allPoints.map((p) => p.timestamp))).sort((a, b) => a - b);
  const minTime = timestamps[0];
  const maxTime = timestamps[timestamps.length - 1];
  const timeSpan = maxTime - minTime || 1;

  // Find max value across all series
  const dataMax = Math.max(...allPoints.map((p) => p.value), 0);
  const maxY = customMaxY !== undefined ? customMaxY : dataMax > 0 ? dataMax * 1.15 : 100;
  const minY = customMinY;
  const ySpan = maxY - minY || 1;

  const width = 600; // Normalized viewBox width
  const padLeft = 40;
  const padRight = 15;
  const padTop = 15;
  const padBottom = 25;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const getX = (t: number) => padLeft + ((t - minTime) / timeSpan) * chartW;
  const getY = (v: number) => padTop + chartH - ((Math.max(v, minY) - minY) / ySpan) * chartH;

  const formatValue = (v: number) => {
    if (valueFormatter) return valueFormatter(v);
    return `${v.toFixed(1)} ${unit}`;
  };

  const formatTime = (t: number) => {
    const d = new Date(t * 1000);
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${mins}`;
  };

  const activeTimestamp = hoverIndex !== null && timestamps[hoverIndex] ? timestamps[hoverIndex] : null;

  return (
    <div className="p-4 rounded-3xl bg-surface-card border border-surface-border flex flex-col justify-between space-y-3 relative group">
      
      {/* Chart Header & Legend */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-xs font-bold text-slate-200">{title}</h4>
        
        <div className="flex items-center gap-3 text-[10px] font-mono">
          {series.map((s) => {
            const activeVal =
              activeTimestamp !== null
                ? s.data.find((p) => p.timestamp === activeTimestamp)?.value
                : s.data[s.data.length - 1]?.value;

            return (
              <div key={s.name} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-slate-400">{s.name}:</span>
                <span className="font-semibold text-white">
                  {activeVal !== undefined ? formatValue(activeVal) : '—'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="w-full relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible select-none"
          onMouseLeave={() => setHoverIndex(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const normX = (mouseX / rect.width) * width;
            if (normX >= padLeft && normX <= width - padRight) {
              const targetTime = minTime + ((normX - padLeft) / chartW) * timeSpan;
              // Find closest timestamp index
              let closestIdx = 0;
              let minDiff = Infinity;
              timestamps.forEach((t, i) => {
                const diff = Math.abs(t - targetTime);
                if (diff < minDiff) {
                  minDiff = diff;
                  closestIdx = i;
                }
              });
              setHoverIndex(closestIdx);
            }
          }}
        >
          <defs>
            {series.map((s, idx) => (
              <linearGradient key={`grad-${idx}`} id={`grad-${title.replace(/\s+/g, '')}-${idx}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.25" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0.0" />
              </linearGradient>
            ))}
          </defs>

          {/* Grid lines (horizontal) */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const yVal = padTop + chartH * (1 - ratio);
            const gridVal = minY + ySpan * ratio;
            return (
              <g key={ratio}>
                <line
                  x1={padLeft}
                  y1={yVal}
                  x2={width - padRight}
                  y2={yVal}
                  stroke="rgba(255, 255, 255, 0.05)"
                  strokeDasharray="3 3"
                />
                <text
                  x={padLeft - 6}
                  y={yVal + 3}
                  textAnchor="end"
                  fontSize="9"
                  fill="rgba(148, 163, 184, 0.5)"
                  fontFamily="monospace"
                >
                  {gridVal >= 1000 ? (gridVal / 1000).toFixed(0) + 'k' : gridVal.toFixed(0)}
                </text>
              </g>
            );
          })}

          {/* Time axis labels */}
          <text
            x={padLeft}
            y={height - 5}
            textAnchor="start"
            fontSize="9"
            fill="rgba(148, 163, 184, 0.5)"
            fontFamily="monospace"
          >
            {formatTime(minTime)}
          </text>
          <text
            x={width - padRight}
            y={height - 5}
            textAnchor="end"
            fontSize="9"
            fill="rgba(148, 163, 184, 0.5)"
            fontFamily="monospace"
          >
            {formatTime(maxTime)}
          </text>

          {/* Series Areas & Lines */}
          {series.map((s, idx) => {
            if (s.data.length === 0) return null;

            const pathPoints = s.data.map((p) => `${getX(p.timestamp)},${getY(p.value)}`).join(' L ');
            const areaPath = `M ${getX(s.data[0].timestamp)},${padTop + chartH} L ${pathPoints} L ${getX(
              s.data[s.data.length - 1].timestamp
            )},${padTop + chartH} Z`;

            return (
              <g key={s.name}>
                {/* Area Fill */}
                <path d={areaPath} fill={`url(#grad-${title.replace(/\s+/g, '')}-${idx})`} />
                
                {/* Stroke Line */}
                <path
                  d={`M ${pathPoints}`}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            );
          })}

          {/* Hover Crosshair & Dots */}
          {activeTimestamp !== null && (
            <g>
              <line
                x1={getX(activeTimestamp)}
                y1={padTop}
                x2={getX(activeTimestamp)}
                y2={padTop + chartH}
                stroke="rgba(255, 255, 255, 0.3)"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
              {series.map((s) => {
                const pt = s.data.find((p) => p.timestamp === activeTimestamp);
                if (!pt) return null;
                return (
                  <circle
                    key={s.name}
                    cx={getX(activeTimestamp)}
                    cy={getY(pt.value)}
                    r="3.5"
                    fill={s.color}
                    stroke="#0a0d14"
                    strokeWidth="2"
                  />
                );
              })}
            </g>
          )}
        </svg>
      </div>

    </div>
  );
};
