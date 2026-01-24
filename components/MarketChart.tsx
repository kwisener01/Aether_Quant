
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
  Label,
  ComposedChart
} from 'recharts';
import { PricePoint, HistoricalSignal, MarketData, TickWindow, TickLabel } from '../types';

interface MarketChartProps {
  data: PricePoint[];
  symbol: string;
  signals: HistoricalSignal[];
  levels?: MarketData['levels'];
  flowHistory?: TickWindow[];
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const price = payload.find((p: any) => p.dataKey === 'price')?.value;
    const lixi = payload.find((p: any) => p.dataKey === 'lixi')?.value;
    const flowLabel = payload[0]?.payload?.flowLabel;

    const getLabelColor = (lbl: string) => {
      if (lbl === TickLabel.UPWARDS) return 'text-emerald-400';
      if (lbl === TickLabel.DOWNWARDS) return 'text-rose-400';
      return 'text-amber-400';
    };

    return (
      <div className="bg-slate-950/98 border border-slate-800 p-3 md:p-4 rounded-xl md:rounded-2xl shadow-2xl backdrop-blur-3xl ring-1 ring-white/5 min-w-[150px] md:min-w-[180px]">
        <p className="text-slate-500 text-[8px] md:text-[10px] font-mono mb-2 md:mb-3 uppercase tracking-[0.15em] border-b border-slate-800 pb-2">{label} EST</p>
        <div className="space-y-2 md:space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-[8px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest">Price</span>
            <span className="text-sky-400 font-black font-mono text-xs md:text-sm">${price?.toFixed(2)}</span>
          </div>
          {lixi !== undefined && (
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-[8px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest">Lixi Depth</span>
                <span className={`font-black font-mono text-xs md:text-sm ${getLabelColor(flowLabel)}`}>{lixi.toFixed(2)}</span>
              </div>
              <div className={`text-[7px] md:text-[9px] font-black uppercase tracking-[0.1em] text-right ${getLabelColor(flowLabel)}`}>
                {flowLabel === TickLabel.UPWARDS ? 'BULLISH' : flowLabel === TickLabel.DOWNWARDS ? 'BEARISH' : 'ABSORPTION'}
              </div>
            </div>
          )}
        </div>
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
      <circle r="12" fill="transparent" className="cursor-pointer" />
      <circle r="5" fill={color} fillOpacity="0.3" stroke={color} strokeWidth="1.5" className="animate-pulse" />
      <path d={isBuy ? "M0 -3 L3 2 L-3 2 Z" : "M0 3 L3 -2 L-3 -2 Z"} fill={color} />
    </g>
  );
};

const MarketChart: React.FC<MarketChartProps> = ({ data, symbol, signals, levels, flowHistory = [] }) => {
  const [hoveredItem, setHoveredItem] = useState<any | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const mergedData = useMemo(() => {
    return data.map((d, i) => {
      const flowIndex = Math.floor((i / data.length) * flowHistory.length);
      const win = flowHistory[flowHistory.length - 1 - flowIndex];
      const lixiValue = win ? win.lixi : 0;
      const label = win ? win.label : TickLabel.STATIONARY;

      return {
        ...d,
        lixi: lixiValue,
        flowLabel: label,
        lixiBull: label === TickLabel.UPWARDS ? lixiValue : null,
        lixiBear: label === TickLabel.DOWNWARDS ? lixiValue : null,
        lixiNeut: label === TickLabel.STATIONARY ? lixiValue : null,
      };
    });
  }, [data, flowHistory]);

  const visibleSignals = signals.filter(s => s.symbol === symbol && data.some(d => d.time === s.chartTime));

  const yPriceDomain = useMemo(() => {
    if (data.length === 0) return ['auto', 'auto'];
    const prices = data.map(d => d.price);
    const pivotValues = levels ? [
      levels.hp, levels.mhp, levels.gammaFlip, levels.maxGamma, levels.vannaPivot
    ].filter(v => v > 0) : [];
    
    const allValues = [...prices, ...pivotValues];
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const padding = (max - min) * 0.1;
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
    <div className="w-full h-full flex flex-col relative">
      <div className="h-[70%] w-full relative">
        <div className="absolute top-1 md:top-2 left-1 md:left-2 z-20 pointer-events-none">
           <span className="px-2 py-0.5 bg-sky-500/10 border border-sky-500/20 text-sky-400 text-[7px] md:text-[9px] font-black uppercase tracking-widest rounded-md backdrop-blur-md">Institutional Tape</span>
        </div>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={mergedData} syncId="aetherSync" margin={{ top: 10, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.15}/>
                <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} strokeOpacity={0.1} />
            <XAxis dataKey="time" hide />
            <YAxis hide domain={yPriceDomain} />
            <Tooltip content={<CustomTooltip />} />
            
            <Area 
              type="monotone" 
              dataKey="price" 
              stroke="#0ea5e9" 
              strokeWidth={2} 
              fillOpacity={1} 
              fill="url(#colorPrice)" 
              isAnimationActive={false} 
            />

            {levels?.gammaFlip && (
              <ReferenceLine y={levels.gammaFlip} stroke="#22d3ee" strokeDasharray="4 4" strokeOpacity={0.3} strokeWidth={1}>
                <Label value="GF" position="insideRight" fill="#22d3ee" fontSize={7} fontWeight="900" />
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
      </div>

      <div className="h-[30%] w-full relative mt-2 md:mt-4 border-t border-slate-800/60 bg-slate-900/5">
        <div className="absolute top-1 md:top-2 left-1 md:left-2 z-20 pointer-events-none">
           <span className="px-2 py-0.5 bg-slate-900/50 border border-slate-800/80 text-slate-400 text-[7px] md:text-[9px] font-black uppercase tracking-widest rounded-md">Lixi Sentiment</span>
        </div>
        
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={mergedData} syncId="aetherSync" margin={{ top: 5, right: 0, bottom: 15, left: 0 }}>
            <defs>
              <linearGradient id="lixiBullGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="lixiBearGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} strokeOpacity={0.05} />
            <XAxis 
              dataKey="time" 
              stroke="#475569" 
              fontSize={7} 
              tickLine={false} 
              axisLine={false} 
              minTickGap={40} 
              fontFamily="JetBrains Mono" 
            />
            <YAxis hide domain={[0, 15]} />
            <Tooltip content={<CustomTooltip />} />
            
            <Area type="monotone" dataKey="lixiBull" stroke="#10b981" strokeWidth={1.5} fillOpacity={1} fill="url(#lixiBullGrad)" connectNulls={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="lixiBear" stroke="#f43f5e" strokeWidth={1.5} fillOpacity={1} fill="url(#lixiBearGrad)" connectNulls={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="lixiNeut" stroke="#f59e0b" strokeWidth={1} fillOpacity={0.1} fill="#f59e0b" connectNulls={false} isAnimationActive={false} />

            <ReferenceLine y={5} stroke="#1e293b" strokeWidth={1} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {hoveredItem && (
        <div 
          className="absolute z-[100] bg-slate-950/98 backdrop-blur-3xl border border-slate-800 p-4 md:p-5 rounded-2xl md:rounded-[2rem] shadow-2xl pointer-events-none -translate-x-1/2 -translate-y-[120%] animate-in fade-in zoom-in duration-300 min-w-[160px] md:min-w-[200px] ring-1 ring-white/10" 
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          <div className="flex justify-between items-start mb-2 md:mb-4">
            <span className="text-[7px] md:text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">{hoveredItem.liquidityZone}</span>
          </div>
          <div className={`text-sm md:text-xl font-black italic tracking-tighter mb-2 md:mb-4 ${hoveredItem.type === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>{hoveredItem.type} SETUP</div>
          <div className="space-y-1 md:space-y-2 pt-2 md:pt-4 border-t border-slate-900">
            <div className="flex justify-between items-center">
              <span className="text-[8px] md:text-[10px] font-bold text-slate-600 uppercase">Confidence</span>
              <span className="text-[9px] md:text-[11px] font-black text-sky-400 tabular-nums">{hoveredItem.voteCount}%</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MarketChart;
