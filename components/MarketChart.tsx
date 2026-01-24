
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
      <div className="bg-slate-950/95 border border-slate-800 p-4 rounded-2xl shadow-2xl backdrop-blur-3xl ring-1 ring-white/5 min-w-[180px]">
        <p className="text-slate-500 text-[10px] font-mono mb-3 uppercase tracking-[0.2em] border-b border-slate-800 pb-2">{label} EST</p>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Price</span>
            <span className="text-sky-400 font-black font-mono text-sm">${price?.toFixed(2)}</span>
          </div>
          {lixi !== undefined && (
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Lixi Depth</span>
                <span className={`font-black font-mono text-sm ${getLabelColor(flowLabel)}`}>{lixi.toFixed(2)}</span>
              </div>
              <div className={`text-[9px] font-black uppercase tracking-[0.15em] text-right ${getLabelColor(flowLabel)}`}>
                {flowLabel === TickLabel.UPWARDS ? 'BULLISH FLOW' : flowLabel === TickLabel.DOWNWARDS ? 'BEARISH FLOW' : 'NEUTRAL ABSORPTION'}
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
      <circle r="14" fill="transparent" className="cursor-crosshair pointer-events-all" />
      <circle r="6" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="2" className="animate-pulse" />
      <path d={isBuy ? "M0 -4 L4 3 L-4 3 Z" : "M0 4 L4 -3 L-4 -3 Z"} fill={color} />
    </g>
  );
};

const MarketChart: React.FC<MarketChartProps> = ({ data, symbol, signals, levels, flowHistory = [] }) => {
  const [hoveredItem, setHoveredItem] = useState<any | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Segment Lixi data by sentiment for multi-color area rendering
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
        // Segmented keys for Area rendering
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
    <div className="w-full h-full flex flex-col relative group">
      {/* Price Pane (Top 70%) */}
      <div className="h-[70%] w-full relative">
        <div className="absolute top-2 left-2 z-20 flex gap-2 pointer-events-none">
           <span className="px-3 py-1 bg-sky-500/10 border border-sky-500/20 text-sky-400 text-[9px] font-black uppercase tracking-widest rounded-lg backdrop-blur-md shadow-xl">Institutional Tape</span>
        </div>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={mergedData} syncId="aetherSync" margin={{ top: 15, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.2}/>
                <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} strokeOpacity={0.15} />
            <XAxis dataKey="time" hide />
            <YAxis hide domain={yPriceDomain} />
            <Tooltip content={<CustomTooltip />} />
            
            <Area 
              type="monotone" 
              dataKey="price" 
              stroke="#0ea5e9" 
              strokeWidth={2.5} 
              fillOpacity={1} 
              fill="url(#colorPrice)" 
              isAnimationActive={true} 
            />

            {/* Levels */}
            {levels?.gammaFlip && (
              <ReferenceLine y={levels.gammaFlip} stroke="#22d3ee" strokeDasharray="4 4" strokeOpacity={0.4} strokeWidth={1}>
                <Label value="GF" position="insideRight" fill="#22d3ee" fontSize={9} fontWeight="900" />
              </ReferenceLine>
            )}
            {levels?.mhp && (
              <ReferenceLine y={levels.mhp} stroke="#f43f5e" strokeOpacity={0.4} strokeWidth={1.5}>
                <Label value="MHP" position="insideLeft" fill="#f43f5e" fontSize={9} fontWeight="900" offset={10} />
              </ReferenceLine>
            )}
            {levels?.hp && (
              <ReferenceLine y={levels.hp} stroke="#f59e0b" strokeOpacity={0.4} strokeWidth={1.5} strokeDasharray="6 2">
                <Label value="HP" position="insideLeft" fill="#f59e0b" fontSize={9} fontWeight="900" offset={10} />
              </ReferenceLine>
            )}

            {/* Signals */}
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

      {/* Lixi Pane (Bottom 30%) - INDICATOR MODE */}
      <div className="h-[30%] w-full relative mt-4 border-t border-slate-800/60 bg-slate-900/10">
        <div className="absolute top-2 left-2 z-20 flex gap-2 pointer-events-none">
           <span className="px-3 py-1 bg-slate-900/50 border border-slate-800/80 text-slate-400 text-[9px] font-black uppercase tracking-widest rounded-lg">Aether Lixi Sentiment</span>
        </div>
        <div className="absolute bottom-2 right-4 z-20 flex gap-4 pointer-events-none">
           <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /><span className="text-[7px] font-black text-slate-500 uppercase tracking-widest">Bullish</span></div>
           <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-rose-500" /><span className="text-[7px] font-black text-slate-500 uppercase tracking-widest">Bearish</span></div>
           <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-amber-500" /><span className="text-[7px] font-black text-slate-500 uppercase tracking-widest">Neutral</span></div>
        </div>
        
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={mergedData} syncId="aetherSync" margin={{ top: 10, right: 0, bottom: 25, left: 0 }}>
            <defs>
              <linearGradient id="lixiBullGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="lixiBearGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4}/>
                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="lixiNeutGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2}/>
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} strokeOpacity={0.1} />
            <XAxis 
              dataKey="time" 
              stroke="#475569" 
              fontSize={8} 
              tickLine={false} 
              axisLine={false} 
              minTickGap={60} 
              fontFamily="JetBrains Mono" 
              dy={10}
            />
            <YAxis hide domain={[0, 15]} />
            <Tooltip content={<CustomTooltip />} />
            
            {/* Sentiment Segments */}
            <Area 
              type="monotone" 
              dataKey="lixiBull" 
              stroke="#10b981" 
              strokeWidth={2} 
              fillOpacity={1} 
              fill="url(#lixiBullGrad)" 
              connectNulls={false}
              isAnimationActive={false}
            />
            <Area 
              type="monotone" 
              dataKey="lixiBear" 
              stroke="#f43f5e" 
              strokeWidth={2} 
              fillOpacity={1} 
              fill="url(#lixiBearGrad)" 
              connectNulls={false}
              isAnimationActive={false}
            />
            <Area 
              type="monotone" 
              dataKey="lixiNeut" 
              stroke="#f59e0b" 
              strokeWidth={1.5} 
              fillOpacity={1} 
              fill="url(#lixiNeutGrad)" 
              connectNulls={false}
              isAnimationActive={false}
            />

            {/* Baseline at 5.0 (Neutral Lixi) */}
            <ReferenceLine y={5} stroke="#1e293b" strokeWidth={1} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Signal Detail Modal Overlay */}
      {hoveredItem && (
        <div 
          className="absolute z-[100] bg-slate-950/98 backdrop-blur-3xl border border-slate-800 p-5 rounded-[2rem] shadow-2xl pointer-events-none -translate-x-1/2 -translate-y-[120%] animate-in fade-in zoom-in duration-300 min-w-[200px] ring-1 ring-white/10" 
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          <div className="flex justify-between items-start mb-4">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">{hoveredItem.liquidityZone}</span>
            {hoveredItem.isGoldenSetup && (
              <span className="px-2 py-0.5 bg-amber-500/20 text-amber-500 border border-amber-500/40 rounded text-[8px] font-black uppercase">Golden</span>
            )}
          </div>
          <div className={`text-xl font-black italic tracking-tighter mb-4 ${hoveredItem.type === 'BUY' ? 'text-emerald-400' : 'text-rose-400'}`}>{hoveredItem.type} SETUP</div>
          <div className="space-y-2 pt-4 border-t border-slate-900">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold text-slate-600 uppercase">Confidence</span>
              <span className="text-[11px] font-black text-sky-400 tabular-nums">{hoveredItem.voteCount}%</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold text-slate-600 uppercase">Risk Level</span>
              <span className="text-[11px] font-black text-emerald-400">{hoveredItem.executionStatus}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MarketChart;
