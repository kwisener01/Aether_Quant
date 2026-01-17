
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
      <div className="bg-slate-900 border border-slate-700 p-2 md:p-3 rounded-lg shadow-2xl backdrop-blur-md">
        <p className="text-slate-500 text-[8px] md:text-[10px] font-mono mb-0.5 md:mb-1 uppercase tracking-widest">{label} EST</p>
        <p className="text-sky-400 font-black font-mono text-xs md:text-sm">${payload[0].value.toFixed(2)}</p>
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
      <circle r="10" fill="transparent" className="pointer-events-all" />
      <circle r="5" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="1.5" className="animate-pulse" />
      <path d={isBuy ? "M0 -3 L3 2.5 L-3 2.5 Z" : "M0 3 L3 -2.5 L-3 -2.5 Z"} fill={color} />
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
    // Increased padding for mobile reference lines
    const padding = (max - min) * 0.15;
    
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
    <div className="w-full h-56 md:h-80 relative group">
      {/* Pivot Legend Bar - Scaled down for Mobile */}
      <div className="absolute top-0 right-0 z-20 flex gap-2 md:gap-3 px-2 md:px-3 py-1 md:py-1.5 rounded-bl-xl bg-slate-900/40 backdrop-blur-md border-l border-b border-slate-800 pointer-events-none opacity-60 md:opacity-40 group-hover:opacity-100 transition-opacity duration-500">
         <div className="flex items-center gap-1">
           <div className="w-1.5 md:w-2 h-0.5 bg-cyan-400" />
           <span className="text-[6px] md:text-[7px] font-black text-slate-400 uppercase tracking-tighter">GF</span>
         </div>
         <div className="flex items-center gap-1">
           <div className="w-1.5 md:w-2 h-0.5 bg-emerald-400" />
           <span className="text-[6px] md:text-[7px] font-black text-slate-400 uppercase tracking-tighter">MG</span>
         </div>
         <div className="flex items-center gap-1">
           <div className="w-1.5 md:w-2 h-0.5 bg-pink-400" />
           <span className="text-[6px] md:text-[7px] font-black text-slate-400 uppercase tracking-tighter">VP</span>
         </div>
         <div className="flex items-center gap-1">
           <div className="w-1.5 md:w-2 h-0.5 bg-amber-500" />
           <span className="text-[6px] md:text-[7px] font-black text-slate-400 uppercase tracking-tighter">HP</span>
         </div>
      </div>

      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} strokeOpacity={0.5} />
          <XAxis dataKey="time" stroke="#475569" fontSize={7} tickLine={false} axisLine={false} minTickGap={50} fontFamily="JetBrains Mono" />
          <YAxis hide domain={yDomain} />
          <Tooltip content={<CustomTooltip />} />
          
          <Area type="monotone" dataKey="price" stroke="#0ea5e9" strokeWidth={1.5} fillOpacity={1} fill="url(#colorPrice)" isAnimationActive={true} />

          {/* Pivot Overlay Engine - Adjusted label fonts for mobile */}
          {levels?.gammaFlip && (
            <ReferenceLine y={levels.gammaFlip} stroke="#22d3ee" strokeDasharray="4 2" strokeOpacity={0.8} strokeWidth={1.5}>
              <Label value="GF" position="insideRight" fill="#22d3ee" fontSize={8} fontWeight="900" offset={5} />
            </ReferenceLine>
          )}
          
          {levels?.maxGamma && (
            <ReferenceLine y={levels.maxGamma} stroke="#10b981" strokeDasharray="8 4" strokeOpacity={0.6} strokeWidth={1}>
              <Label value="MG" position="insideRight" fill="#10b981" fontSize={7} fontWeight="700" offset={5} />
            </ReferenceLine>
          )}

          {levels?.vannaPivot && (
            <ReferenceLine y={levels.vannaPivot} stroke="#f472b6" strokeDasharray="2 2" strokeOpacity={0.7} strokeWidth={1}>
              <Label value="VP" position="insideLeft" fill="#f472b6" fontSize={8} fontWeight="900" offset={5} />
            </ReferenceLine>
          )}

          {levels?.hp && (
            <ReferenceLine y={levels.hp} stroke="#f59e0b" strokeDasharray="5 5" strokeOpacity={0.4}>
              <Label value="HP" position="insideLeft" fill="#f59e0b" fontSize={7} fontWeight="600" offset={5} />
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
          className="absolute z-[100] glass-effect border border-slate-700 p-2 md:p-3 rounded-lg shadow-2xl pointer-events-none -translate-x-1/2 -translate-y-[110%] animate-in fade-in zoom-in duration-200" 
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          <div className="space-y-0.5 md:space-y-1">
            <span className="block text-[7px] text-slate-500 font-black uppercase tracking-[0.2em]">{hoveredItem.liquidityZone}</span>
            <span className="block text-[10px] md:text-xs font-black neon-text-blue uppercase tracking-tight">{hoveredItem.type} @ ${hoveredItem.priceAtSignal.toFixed(1)}</span>
            <div className="flex items-center gap-1.5 mt-0.5">
               <div className="px-1 py-0.5 bg-sky-500/10 rounded text-[6px] text-sky-400 font-bold">{hoveredItem.voteCount}/100 VOTES</div>
            </div>
          </div>
          <div className="absolute left-1/2 bottom-[-4px] -translate-x-1/2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-slate-800" />
        </div>
      )}
    </div>
  );
};

export default MarketChart;
