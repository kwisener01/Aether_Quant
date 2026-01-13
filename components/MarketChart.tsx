
import React, { useState } from 'react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceDot
} from 'recharts';
import { PricePoint, HistoricalSignal } from '../types';

interface MarketChartProps {
  data: PricePoint[];
  symbol: string;
  signals: HistoricalSignal[];
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-2xl backdrop-blur-md">
        <p className="text-slate-500 text-[10px] font-mono mb-1 uppercase tracking-widest">{label} EST</p>
        <p className="text-sky-400 font-black font-mono text-sm">${payload[0].value.toFixed(2)}</p>
      </div>
    );
  }
  return null;
};

// Custom marker component for signals
const SignalMarker = (props: any) => {
  const { cx, cy, payload, onMouseEnter, onMouseLeave } = props;
  const isBuy = payload.type === 'BUY';
  const color = isBuy ? '#10b981' : '#f43f5e';
  
  return (
    <g 
      transform={`translate(${cx},${cy})`}
      onMouseEnter={(e) => onMouseEnter(e, payload, cx, cy, 'SIGNAL')}
      onMouseLeave={onMouseLeave}
      className="cursor-crosshair"
    >
      <circle 
        r="12" 
        fill="transparent" 
        className="pointer-events-all"
      />
      <circle 
        r="6" 
        fill={color} 
        fillOpacity="0.2" 
        stroke={color} 
        strokeWidth="1.5"
        className="animate-pulse pointer-events-none"
      />
      <path 
        d={isBuy ? "M0 -4 L4 3 L-4 3 Z" : "M0 4 L4 -3 L-4 -3 Z"} 
        fill={color}
        className="pointer-events-none"
      />
    </g>
  );
};

// Flow marker for Gamma (GEX) and Vanna metrics
const FlowMarker = (props: any) => {
  const { cx, cy, payload, type, onMouseEnter, onMouseLeave } = props;
  const isGamma = type === 'GAMMA';
  // Amber for Gamma, Purple for Vanna
  const color = isGamma ? '#f59e0b' : '#a855f7';
  
  return (
    <g 
      transform={`translate(${cx},${cy})`}
      onMouseEnter={(e) => onMouseEnter(e, payload, cx, cy, type)}
      onMouseLeave={onMouseLeave}
      className="cursor-help"
    >
      <circle 
        r="10" 
        fill="transparent" 
        className="pointer-events-all"
      />
      {isGamma ? (
        // Diamond Shape for Gamma
        <path 
          d="M0 -5 L5 0 L0 5 L-5 0 Z" 
          fill={color} 
          fillOpacity="0.6" 
          stroke={color} 
          strokeWidth="1"
          className="pointer-events-none"
        />
      ) : (
        // Circular Shape for Vanna
        <circle 
          r="4" 
          fill={color} 
          fillOpacity="0.4" 
          stroke={color} 
          strokeWidth="1"
          className="pointer-events-none"
        />
      )}
    </g>
  );
};

const MarketChart: React.FC<MarketChartProps> = ({ data, symbol, signals }) => {
  const [hoveredItem, setHoveredItem] = useState<any | null>(null);
  const [hoverType, setHoverType] = useState<'SIGNAL' | 'GAMMA' | 'VANNA' | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Filter signals that belong to the current symbol and exist within the chart's current data set
  const visibleSignals = signals.filter(s => 
    s.symbol === symbol && data.some(d => d.time === s.chartTime)
  );

  // Extract key points that have gamma or vanna metrics
  const flowPoints = data.filter(d => d.gamma !== undefined || d.vanna !== undefined);

  const handleMouseEnter = (_: any, item: any, cx: number, cy: number, type: 'SIGNAL' | 'GAMMA' | 'VANNA') => {
    setHoveredItem(item);
    setHoverType(type);
    setTooltipPos({ x: cx, y: cy });
  };

  const handleMouseLeave = () => {
    setHoveredItem(null);
    setHoverType(null);
  };

  return (
    <div className="w-full h-64 md:h-80 relative">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} strokeOpacity={0.5} />
          <XAxis 
            dataKey="time" 
            stroke="#475569" 
            fontSize={8} 
            tickLine={false} 
            axisLine={false} 
            minTickGap={100}
            fontFamily="JetBrains Mono"
          />
          <YAxis 
            hide 
            domain={['auto', 'auto']}
          />
          <Tooltip content={<CustomTooltip />} />
          
          <Area 
            type="monotone" 
            dataKey="price" 
            stroke="#0ea5e9" 
            strokeWidth={1.5}
            fillOpacity={1} 
            fill="url(#colorPrice)" 
            animationDuration={800}
            isAnimationActive={true}
          />

          {/* Render Signal Markers */}
          {visibleSignals.map((signal) => (
            <ReferenceDot
              key={signal.id}
              x={signal.chartTime}
              y={signal.priceAtSignal}
              shape={
                <SignalMarker 
                  payload={signal} 
                  onMouseEnter={handleMouseEnter}
                  onMouseLeave={handleMouseLeave}
                />
              }
              isFront={true}
            />
          ))}

          {/* Render Flow Markers (GEX/Vanna) */}
          {flowPoints.flatMap((point, idx) => {
            const dots = [];
            if (point.gamma !== undefined) {
              dots.push(
                <ReferenceDot
                  key={`gamma-${idx}`}
                  x={point.time}
                  y={point.price}
                  shape={
                    <FlowMarker 
                      type="GAMMA"
                      payload={point}
                      onMouseEnter={handleMouseEnter}
                      onMouseLeave={handleMouseLeave}
                    />
                  }
                />
              );
            }
            if (point.vanna !== undefined) {
              dots.push(
                <ReferenceDot
                  key={`vanna-${idx}`}
                  x={point.time}
                  y={point.price}
                  shape={
                    <FlowMarker 
                      type="VANNA"
                      payload={point}
                      onMouseEnter={handleMouseEnter}
                      onMouseLeave={handleMouseLeave}
                    />
                  }
                />
              );
            }
            return dots;
          })}
        </AreaChart>
      </ResponsiveContainer>

      {/* Unified Tooltip Overlay for Signals and Flow Metrics */}
      {hoveredItem && (
        <div 
          className="absolute z-[100] glass-effect border border-slate-700 p-3 rounded-xl shadow-[0_0_30px_rgba(0,0,0,0.5)] pointer-events-none -translate-x-1/2 -translate-y-[120%] animate-in fade-in zoom-in duration-200"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          {hoverType === 'SIGNAL' ? (
            <div className="space-y-1">
              <span className="block text-[8px] text-slate-500 font-black uppercase tracking-[0.3em]">Institutional Zone</span>
              <span className="block text-xs font-black neon-text-blue uppercase tracking-tight">
                {hoveredItem.liquidityZone}
              </span>
              <div className="pt-2 border-t border-slate-800 flex items-center gap-2">
                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${
                  hoveredItem.type === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                }`}>
                  {hoveredItem.type} @ ${hoveredItem.priceAtSignal.toFixed(2)}
                </span>
              </div>
            </div>
          ) : hoverType === 'GAMMA' ? (
            <div className="space-y-1">
              <span className="block text-[8px] text-amber-500 font-black uppercase tracking-[0.3em]">Gamma Exposure (GEX)</span>
              <div className="flex items-center gap-2">
                 <div className="w-1.5 h-1.5 rotate-45 bg-amber-500" />
                 <span className="block text-xs font-mono font-bold text-white tracking-widest">
                  {hoveredItem.gamma > 0 ? '+' : ''}{hoveredItem.gamma}bn
                </span>
              </div>
              <span className="block text-[7px] text-slate-500 uppercase font-mono tracking-widest">{hoveredItem.time} EST</span>
            </div>
          ) : (
            <div className="space-y-1">
              <span className="block text-[8px] text-purple-400 font-black uppercase tracking-[0.3em]">Vanna Exposure Level</span>
              <span className="block text-xs font-mono font-bold text-white tracking-widest">
                LVL: {hoveredItem.vanna}
              </span>
              <span className="block text-[7px] text-slate-500 uppercase font-mono tracking-widest">{hoveredItem.time} EST</span>
            </div>
          )}
          {/* Tooltip Arrow */}
          <div className="absolute left-1/2 bottom-[-6px] -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-slate-800" />
        </div>
      )}
    </div>
  );
};

export default MarketChart;
