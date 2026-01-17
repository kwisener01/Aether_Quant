
import React, { useState } from 'react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceDot,
  ReferenceLine,
  Label
} from 'recharts';
import { PricePoint, HistoricalSignal, MarketData } from '../types';

interface MarketChartProps {
  data: PricePoint[];
  symbol: string;
  signals: HistoricalSignal[];
  levels?: MarketData['levels'];
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

const SignalMarker = (props: any) => {
  const { cx, cy, payload, onMouseEnter, onMouseLeave } = props;
  const isBuy = payload.type === 'BUY';
  const color = isBuy ? '#10b981' : '#f43f5e';
  return (
    <g transform={`translate(${cx},${cy})`} onMouseEnter={(e) => onMouseEnter(e, payload, cx, cy, 'SIGNAL')} onMouseLeave={onMouseLeave}>
      <circle r="12" fill="transparent" className="pointer-events-all" />
      <circle r="6" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="1.5" className="animate-pulse" />
      <path d={isBuy ? "M0 -4 L4 3 L-4 3 Z" : "M0 4 L4 -3 L-4 -3 Z"} fill={color} />
    </g>
  );
};

const MarketChart: React.FC<MarketChartProps> = ({ data, symbol, signals, levels }) => {
  const [hoveredItem, setHoveredItem] = useState<any | null>(null);
  const [hoverType, setHoverType] = useState<'SIGNAL' | 'LEVEL' | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const visibleSignals = signals.filter(s => s.symbol === symbol && data.some(d => d.time === s.chartTime));

  const handleMouseEnter = (_: any, item: any, cx: number, cy: number, type: 'SIGNAL' | 'LEVEL') => {
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
          <XAxis dataKey="time" stroke="#475569" fontSize={8} tickLine={false} axisLine={false} minTickGap={100} fontFamily="JetBrains Mono" />
          <YAxis hide domain={['auto', 'auto']} />
          <Tooltip content={<CustomTooltip />} />
          
          <Area type="monotone" dataKey="price" stroke="#0ea5e9" strokeWidth={1.5} fillOpacity={1} fill="url(#colorPrice)" isAnimationActive={true} />

          {/* Institutional Bias Levels */}
          {levels?.hp && (
            <ReferenceLine y={levels.hp} stroke="#f59e0b" strokeDasharray="5 5" strokeOpacity={0.5}>
              <Label value="HP" position="left" fill="#f59e0b" fontSize={8} className="font-bold" />
            </ReferenceLine>
          )}
          {levels?.mhp && (
            <ReferenceLine y={levels.mhp} stroke="#a855f7" strokeDasharray="5 5" strokeOpacity={0.5}>
              <Label value="MHP" position="left" fill="#a855f7" fontSize={8} className="font-bold" />
            </ReferenceLine>
          )}
          {levels?.hg && (
            <ReferenceLine y={levels.hg} stroke="#10b981" strokeDasharray="2 2" strokeOpacity={0.3}>
              <Label value="HG" position="left" fill="#10b981" fontSize={8} className="font-bold" />
            </ReferenceLine>
          )}

          {visibleSignals.map((signal) => (
            <ReferenceDot key={signal.id} x={signal.chartTime} y={signal.priceAtSignal} shape={<SignalMarker payload={signal} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} />} isFront={true} />
          ))}
        </AreaChart>
      </ResponsiveContainer>

      {hoveredItem && (
        <div className="absolute z-[100] glass-effect border border-slate-700 p-3 rounded-xl shadow-2xl pointer-events-none -translate-x-1/2 -translate-y-[120%] animate-in fade-in zoom-in duration-200" style={{ left: tooltipPos.x, top: tooltipPos.y }}>
          <div className="space-y-1">
            <span className="block text-[8px] text-slate-500 font-black uppercase tracking-[0.3em]">{hoveredItem.liquidityZone}</span>
            <span className="block text-xs font-black neon-text-blue uppercase tracking-tight">{hoveredItem.type} @ ${hoveredItem.priceAtSignal.toFixed(2)}</span>
          </div>
          <div className="absolute left-1/2 bottom-[-6px] -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-slate-800" />
        </div>
      )}
    </div>
  );
};

export default MarketChart;
