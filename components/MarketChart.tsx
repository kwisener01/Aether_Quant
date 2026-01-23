
import React, { useState, useMemo } from 'react';
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
    <g transform={`translate(${cx},${cy})`} onMouseEnter={(e) => onMouseEnter(e, payload, cx, cy)} onMouseLeave={onMouseLeave}>
      <circle r="12" fill="transparent" className="pointer-events-all" />
      <circle r="6" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="2" className="animate-pulse" />
      <path d={isBuy ? "M0 -4 L4 3 L-4 3 Z" : "M0 4 L4 -3 L-4 -3 Z"} fill={color} />
    </g>
  );
};

const MarketChart: React.FC<MarketChartProps> = ({ data, symbol, signals, levels }) => {
  const [hoveredItem, setHoveredItem] = useState<any | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const visibleSignals = signals.filter(s => s.symbol === symbol && data.some(d => d.time === s.chartTime));

  const yDomain = useMemo(() => {
    if (data.length === 0) return ['auto', 'auto'];
    const prices = data.map(d => d.price);
    const pivotValues = levels ? [
      levels.hp, levels.mhp, levels.gammaFlip, levels.maxGamma, levels.vannaPivot, levels.hg
    ].filter(v => v > 0) : [];
    
    const allValues = [...prices, ...pivotValues];
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const padding = (max - min) * 0.2;
    return [min - padding, max + padding];
  }, [data, levels]);

  const handleMouseEnter = (_: any, item: any, cx: number, cy: number) => {
    setHoveredItem(item);
    setTooltipPos({ x: cx, y: cy });
  };

  const handleMouseLeave = () => {
    setHoveredItem(null);
  };

  return (
    <div className="w-full h-64 md:h-96 relative group">
      <div className="absolute top-2 left-2 z-20 flex flex-col gap-1 pointer-events-none">
        <div className="flex items-center gap-2"><div className="w-2 h-0.5 bg-amber-500" /><span className="text-[7px] font-black text-slate-500 uppercase">HP (WEEKLY)</span></div>
        <div className="flex items-center gap-2"><div className="w-2 h-0.5 bg-rose-500" /><span className="text-[7px] font-black text-slate-500 uppercase">MHP (MONTHLY)</span></div>
      </div>

      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} strokeOpacity={0.3} />
          <XAxis dataKey="time" stroke="#475569" fontSize={8} tickLine={false} axisLine={false} minTickGap={60} fontFamily="JetBrains Mono" />
          <YAxis hide domain={yDomain} />
          <Tooltip content={<CustomTooltip />} />
          
          <Area type="monotone" dataKey="price" stroke="#0ea5e9" strokeWidth={2} fillOpacity={1} fill="url(#colorPrice)" isAnimationActive={true} />

          {/* Institutional Levels Visualization */}
          {levels?.gammaFlip && (
            <ReferenceLine y={levels.gammaFlip} stroke="#22d3ee" strokeDasharray="4 2" strokeOpacity={0.8} strokeWidth={1.5}>
              <Label value="GF" position="insideRight" fill="#22d3ee" fontSize={10} fontWeight="900" />
            </ReferenceLine>
          )}
          
          {levels?.mhp && (
            <ReferenceLine y={levels.mhp} stroke="#f43f5e" strokeOpacity={0.9} strokeWidth={2.5}>
              <Label value="MHP (Monthly Pressure)" position="insideLeft" fill="#f43f5e" fontSize={9} fontWeight="900" offset={10} />
            </ReferenceLine>
          )}

          {levels?.hp && (
            <ReferenceLine y={levels.hp} stroke="#f59e0b" strokeOpacity={0.8} strokeWidth={2} strokeDasharray="6 3">
              <Label value="HP (Weekly Pressure)" position="insideLeft" fill="#f59e0b" fontSize={9} fontWeight="900" offset={10} />
            </ReferenceLine>
          )}

          {levels?.vannaPivot && (
            <ReferenceLine y={levels.vannaPivot} stroke="#f472b6" strokeDasharray="3 3" strokeOpacity={0.6}>
              <Label value="VP" position="insideRight" fill="#f472b6" fontSize={8} fontWeight="900" />
            </ReferenceLine>
          )}

          {visibleSignals.map((signal) => (
            <ReferenceDot 
              key={signal.id} 
              x={signal.chartTime} 
              y={signal.priceAtSignal} 
              shape={<SignalMarker payload={signal} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} />} 
              isFront={true} 
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>

      {hoveredItem && (
        <div 
          className="absolute z-[100] bg-slate-900/90 backdrop-blur-xl border border-slate-700 p-3 rounded-xl shadow-2xl pointer-events-none -translate-x-1/2 -translate-y-[110%] animate-in fade-in zoom-in duration-200 min-w-[140px]" 
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          <span className="block text-[8px] text-slate-500 font-black uppercase mb-1 tracking-widest">{hoveredItem.liquidityZone}</span>
          <span className={`block text-xs font-black uppercase ${hoveredItem.type === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>{hoveredItem.type} Signal</span>
          <div className="flex justify-between mt-2 pt-2 border-t border-slate-800">
            <span className="text-[9px] font-bold text-slate-400 uppercase">Weight</span>
            <span className="text-[9px] font-black text-sky-400">{hoveredItem.voteCount}/100</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default MarketChart;
