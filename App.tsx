
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MarketData, AnalysisResponse, HistoricalSignal, PricePoint, Tick, TickWindow, TickLabel, PropChallengeStats, Alert } from './types';
import { SYMBOLS, ICONS } from './constants';
import { analyzeMarket, fetchMarketDataViaSearch } from './services/geminiService';
import { TradierService } from './services/tradierService';
import MarketChart from './components/MarketChart';

const generateSafeId = () => {
  try {
    return (window.crypto && window.crypto.randomUUID) 
      ? window.crypto.randomUUID() 
      : Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  } catch (e) {
    return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  }
};

const formatToEST = (date: Date) => {
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
};

type StreamingStatus = 'IDLE' | 'TRADIER_PRO' | 'GROUNDED' | 'OFFLINE' | 'TIMEOUT' | 'ERROR';

const App: React.FC = () => {
  const [selectedSymbol, setSelectedSymbol] = useState(SYMBOLS[0]);
  const [isTradierConnected, setIsTradierConnected] = useState(false);
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingData, setFetchingData] = useState(false);
  const [apiError, setApiError] = useState<'QUOTA' | 'TIMEOUT' | 'FETCH' | 'ANALYSIS' | null>(null);
  const [showVault, setShowVault] = useState(false);
  const [inputToken, setInputToken] = useState('');
  const [isSandbox, setIsSandbox] = useState(false);
  const [signalHistory, setSignalHistory] = useState<HistoricalSignal[]>([]);
  const [streamingStatus, setStreamingStatus] = useState<StreamingStatus>('IDLE');
  const [lastRefresh, setLastRefresh] = useState<string>('NEVER');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [countdown, setCountdown] = useState(30);
  
  const [propStats] = useState<PropChallengeStats>({
    startingBalance: 50000,
    currentEquity: 50000,
    profitTarget: 53000,
    maxDrawdown: 48000,
    currentDrawdown: 0,
    dailyLossLimit: 49000,
    status: 'ACTIVE'
  });

  const [windowHistory, setWindowHistory] = useState<TickWindow[]>([]);
  const tradierRef = useRef<TradierService | null>(null);
  const fetchLock = useRef<boolean>(false);

  // Derived state for the most recent LIXI
  const currentLixi = windowHistory.length > 0 ? windowHistory[0].lixi : 0;
  const isGoldenFlow = currentLixi > 7.5;

  const addAlert = useCallback((type: Alert['type'], message: string) => {
    const newAlert: Alert = { id: generateSafeId(), type, message, timestamp: new Date().toLocaleTimeString() };
    setAlerts(prev => [newAlert, ...prev].slice(0, 5));
    setTimeout(() => {
      setAlerts(prev => prev.filter(a => a.id !== newAlert.id));
    }, 8000);
  }, []);

  const fetchData = useCallback(async (forceSymbol?: string) => {
    const symbol = forceSymbol || selectedSymbol;
    if (fetchLock.current && !forceSymbol) return;
    
    fetchLock.current = true;
    setFetchingData(true);
    setApiError(null);
    
    try {
      let historyPoints: PricePoint[] = [];
      let dataSource: StreamingStatus = 'GROUNDED';
      let currentPrice = 0;

      if (tradierRef.current && isTradierConnected) {
        try {
          const [bars, quote] = await Promise.all([
            tradierRef.current.getIntradayHistory(symbol),
            tradierRef.current.getQuotes([symbol])
          ]);
          
          if (bars && bars.length > 0) {
            historyPoints = bars.map(b => ({
              time: b.date.includes(' ') ? b.date.split(' ')[1] : b.date,
              price: b.close,
              volume: b.volume
            }));
            dataSource = 'TRADIER_PRO';
            currentPrice = quote[0]?.last || (historyPoints.length > 0 ? historyPoints[historyPoints.length - 1].price : 0);
          }
        } catch (err: any) {
          console.warn("Tradier extraction bypassed, falling back to Gemini grounding.");
          dataSource = 'GROUNDED';
        }
      }

      const searchMeta = await fetchMarketDataViaSearch(symbol);
      
      if (historyPoints.length === 0) {
        historyPoints = (searchMeta.history || []).map((h: any) => ({
          time: h.time,
          price: parseFloat(h.price) || 0,
          volume: 0
        }));
      }

      if (historyPoints.length === 0 || historyPoints[0].price === 0) {
        setStreamingStatus('OFFLINE');
      } else {
        setStreamingStatus(dataSource);
        const service = tradierRef.current || new TradierService("");
        const hftFeed: Tick[] = historyPoints.slice(-16).map(p => ({
          time: Date.now(),
          bid: p.price - 0.01,
          ask: p.price + 0.01,
          mid: p.price,
          last: p.price,
          spread: 0.02,
          volume: p.volume || 100,
          bidVolume: 50,
          askVolume: 50
        }));

        const windows: TickWindow[] = [];
        for (let i = 0; i < hftFeed.length; i += 4) {
          const chunk = hftFeed.slice(i, i + 4);
          if (chunk.length > 0) {
            const win = service.calculateWindowLabel(chunk, chunk[0].mid);
            if (win.lixi > 8.0) addAlert('GOLDEN', `URGENT: Insane Flow Spike on ${symbol}! LIXI: ${win.lixi.toFixed(2)}. Watch for expansion.`);
            windows.push(win);
          }
        }
        setWindowHistory(windows.reverse());
      }

      const hp = parseFloat(searchMeta.hp) || 0;
      const mhp = parseFloat(searchMeta.mhp) || 0;
      let bias: any = 'NEUTRAL';
      if (hp === mhp && hp !== 0) bias = 'SQUEEZE';
      else if (hp > mhp) bias = 'BULLISH';
      else if (mhp > hp) bias = 'BEARISH';

      setMarketData({
        symbol,
        currentPrice: currentPrice || parseFloat(searchMeta.currentPrice) || (historyPoints.length > 0 ? historyPoints[historyPoints.length - 1].price : 0),
        change24h: parseFloat(searchMeta.change24h) || 0,
        volume24h: 0,
        vix: parseFloat(searchMeta.vix) || 15,
        history: historyPoints,
        levels: { 
          hp, mhp, 
          hg: (parseFloat(searchMeta.yesterdayClose) + parseFloat(searchMeta.todayOpen)) / 2 || 0, 
          gammaFlip: parseFloat(searchMeta.gammaFlip) || 0, 
          maxGamma: parseFloat(searchMeta.maxGamma) || 0, 
          vannaPivot: parseFloat(searchMeta.vannaPivot) || 0, 
          bias 
        }
      });
      setLastRefresh(formatToEST(new Date()));
      setCountdown(isTradierConnected ? 30 : 60);
    } catch (e: any) {
      setApiError('FETCH');
      addAlert('SYSTEM', `Connectivity Error: Data grounding failed.`);
    } finally { 
      setFetchingData(false);
      fetchLock.current = false;
    }
  }, [selectedSymbol, isTradierConnected, addAlert]);

  const handleSymbolChange = (s: string) => {
    setSelectedSymbol(s);
    setMarketData(null);
    setWindowHistory([]);
    fetchData(s);
  };

  const runAnalysis = useCallback(async () => {
    if (!marketData || windowHistory.length === 0 || loading) return;
    setLoading(true);
    setApiError(null);
    try {
      const result = await analyzeMarket(marketData, windowHistory);
      setAnalysis(result);
      const sig = result.signal;
      if (sig.voteCount >= 85) {
        addAlert('SIGNAL', `PREMIUM SETUP: ${sig.type} ${sig.voteCount}% Confidence at $${sig.entry.toFixed(2)}`);
      }
      
      setSignalHistory(prev => [{
        ...sig, id: generateSafeId(), symbol: marketData.symbol, timestamp: new Date().toISOString(),
        chartTime: formatToEST(new Date()), priceAtSignal: marketData.currentPrice,
        liquidityZone: sig.isGoldenSetup ? 'GOLDEN SETUP' : sig.liquidityZone || 'NEUTRAL'
      }, ...prev].slice(0, 50));
    } catch (e) { 
      setApiError('ANALYSIS'); 
    } finally { setLoading(false); }
  }, [marketData, windowHistory, loading, addAlert]);

  useEffect(() => {
    const savedToken = localStorage.getItem('TRADIER_TOKEN');
    const savedSandbox = localStorage.getItem('TRADIER_SANDBOX') === 'true';
    if (savedToken) {
      tradierRef.current = new TradierService(savedToken, savedSandbox);
      setIsTradierConnected(true);
      setIsSandbox(savedSandbox);
      setInputToken(savedToken);
    }
    
    (window as any).aistudio.hasSelectedApiKey().then((has: boolean) => {
      setHasGeminiKey(has);
      if (has) fetchData();
    });
  }, []);

  // Timer Effect for Next Sync
  useEffect(() => {
    if (!hasGeminiKey) return;
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          fetchData();
          return isTradierConnected ? 30 : 60;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [fetchData, hasGeminiKey, isTradierConnected]);

  const handleSaveToken = () => {
    localStorage.setItem('TRADIER_TOKEN', inputToken);
    localStorage.setItem('TRADIER_SANDBOX', isSandbox.toString());
    tradierRef.current = new TradierService(inputToken, isSandbox);
    setIsTradierConnected(true);
    setShowVault(false);
    fetchData();
    addAlert('SYSTEM', "Tradier Institutional Bridge Established.");
  };

  const getStatusColor = (status: StreamingStatus) => {
    switch(status) {
      case 'TRADIER_PRO': return 'bg-emerald-500 shadow-[0_0_15px_#10b981]';
      case 'GROUNDED': return 'bg-sky-500 shadow-[0_0_15px_#0ea5e9]';
      default: return 'bg-slate-700';
    }
  };

  const oracleReady = marketData && windowHistory.length > 0;

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto space-y-6 bg-[#020617] text-[#f8fafc] overflow-x-hidden relative selection:bg-sky-500/30">
      <div className="fixed top-24 right-8 z-[2000] flex flex-col gap-3 max-w-sm w-full pointer-events-none">
        {alerts.map(alert => (
          <div key={alert.id} className={`p-5 rounded-2xl border backdrop-blur-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] transition-all duration-500 pointer-events-auto ${alert.type === 'GOLDEN' ? 'bg-amber-500/10 border-amber-500/50 text-amber-500' : alert.type === 'SIGNAL' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' : 'bg-slate-900 border-slate-700 text-slate-300'}`}>
            <div className="flex justify-between items-start mb-2">
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">{alert.type} TRIGGER</span>
              <span className="text-[8px] font-mono opacity-50">{alert.timestamp}</span>
            </div>
            <p className="text-sm font-bold leading-tight tracking-tight">{alert.message}</p>
          </div>
        ))}
      </div>

      <nav className="flex flex-col lg:flex-row justify-between items-center gap-6 px-8 py-5 bg-slate-900/40 backdrop-blur-3xl rounded-[2.5rem] border border-slate-800/60 shadow-2xl relative z-50">
        <div className="flex flex-col sm:flex-row items-center gap-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-black tracking-tighter neon-text-blue leading-none italic">AETHER ORACLE</h1>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${getStatusColor(streamingStatus)} ${fetchingData ? 'animate-pulse' : ''}`} />
                <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">{streamingStatus.replace('_', ' ')}</span>
              </div>
              <div className="h-3 w-px bg-slate-800" />
              <div className="flex items-center gap-1.5">
                 <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-600">NEXT SYNC:</span>
                 <span className="text-[9px] font-mono text-sky-400 font-bold tabular-nums">{countdown}s</span>
              </div>
            </div>
          </div>
          <div className="flex bg-slate-950/90 p-1.5 rounded-2xl border border-slate-800 shadow-inner">
            {SYMBOLS.map(s => (
              <button key={s} disabled={fetchingData && s !== selectedSymbol} onClick={() => handleSymbolChange(s)} className={`px-8 py-2.5 rounded-xl text-[11px] font-black transition-all duration-300 ${selectedSymbol === s ? 'bg-sky-500 text-white shadow-[0_10px_20px_rgba(14,165,233,0.4)] scale-105' : 'text-slate-500 hover:text-slate-300'}`}>{s}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right border-r border-slate-800/60 pr-8 hidden sm:block">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-1">Pass Status</span>
            <div className="text-sm font-mono font-bold text-emerald-400 tabular-nums">${propStats.currentEquity.toLocaleString()}</div>
          </div>
          <button onClick={() => setShowVault(true)} className={`p-4 rounded-2xl border transition-all ${isTradierConnected ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-800/40 border-slate-700 text-sky-400'}`}>
            <ICONS.Shield size={20} />
          </button>
        </div>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-10">
        <div className="lg:col-span-3">
          <div className="glass-effect rounded-[2.5rem] p-7 border border-slate-800/40 h-[700px] flex flex-col shadow-2xl relative overflow-hidden">
            <div className="flex justify-between items-center mb-8">
              <div className="space-y-0.5">
                <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Aether Flow</h3>
                <p className="text-[8px] text-slate-600 font-mono uppercase tracking-widest">{isTradierConnected ? 'Real-Time Pipeline' : 'Grounded Snapshot'}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-black text-slate-600 uppercase tabular-nums">-{countdown}s</span>
                <button onClick={() => fetchData()} disabled={fetchingData} className="p-2 bg-sky-500/10 hover:bg-sky-500/20 rounded-lg text-sky-400 transition-all active:scale-90"><ICONS.Activity size={14} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto space-y-4 pr-2 scrollbar-hide">
              {windowHistory.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-10 gap-4"><ICONS.Activity size={48} className="animate-pulse" /><p className="text-[10px] font-black uppercase tracking-widest">Diving for liquidity...</p></div>
              ) : windowHistory.map(win => (
                <div key={win.id} className={`p-5 rounded-2xl border transition-all duration-700 ${win.lixi > 7.5 ? 'border-amber-500/60 bg-amber-500/[0.05] shadow-[0_0_20px_rgba(245,158,11,0.1)]' : 'border-slate-800/40 bg-slate-950/30'}`}>
                  <div className="flex justify-between text-[8px] font-mono mb-3">
                    <span className="text-slate-500">{win.timestamp}</span>
                    <span className={win.lixi > 7.5 ? 'text-amber-500 font-black tracking-widest' : 'text-slate-600'}>{win.lixi > 7.5 ? 'GOLDEN FLOW' : 'NEUTRAL'}</span>
                  </div>
                  <div className="flex justify-between items-end">
                    <div className={`text-sm font-black italic tracking-tighter ${win.label === TickLabel.UPWARDS ? 'text-emerald-400' : win.label === TickLabel.DOWNWARDS ? 'text-rose-400' : 'text-slate-500'}`}>{win.label}</div>
                    <div className="text-right">
                      <span className={`text-2xl font-black mono block leading-none ${win.lixi > 7.5 ? 'text-amber-400 text-glow-amber' : 'text-sky-400'}`}>{win.lixi.toFixed(2)}</span>
                      <span className="text-[7px] font-bold text-slate-500 uppercase tracking-widest mt-1 block">LIXI DEPTH</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-6 space-y-8">
          <div className={`glass-effect rounded-[2.5rem] p-10 transition-all duration-700 ${isGoldenFlow ? 'border-amber-500/50 shadow-[0_0_60px_rgba(245,158,11,0.15)]' : 'border-sky-500/10 shadow-2xl'} min-h-[550px] relative overflow-hidden`}>
            {fetchingData && !marketData ? (
               <div className="h-[400px] flex flex-col items-center justify-center gap-6"><div className="w-16 h-16 border-4 border-sky-500/10 border-t-sky-500 rounded-full animate-spin" /><p className="text-[10px] font-black uppercase tracking-[0.4em] text-sky-500 animate-pulse">Grounding institutional data...</p></div>
            ) : marketData ? (
              <div className="space-y-8 animate-in fade-in duration-1000">
                <div className="flex justify-between items-end">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <span className="px-4 py-1.5 bg-slate-800 text-white rounded-full text-[10px] font-black uppercase tracking-[0.2em]">{selectedSymbol} / USD</span>
                      <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${marketData.levels?.bias === 'BULLISH' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>{marketData.levels?.bias} BIAS</span>
                      {isGoldenFlow && (
                        <span className="px-3 py-0.5 bg-amber-500/20 text-amber-500 border border-amber-500/30 rounded text-[10px] font-black uppercase tracking-widest animate-pulse shadow-[0_0_10px_rgba(245,158,11,0.3)]">GOLDEN FLOW ACTIVE</span>
                      )}
                    </div>
                    <div className={`text-6xl sm:text-8xl font-black mono tracking-tighter leading-none transition-colors duration-500 ${isGoldenFlow ? 'text-amber-400 text-glow-amber' : 'text-glow-blue'}`}>${marketData.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div className="text-right space-y-2 hidden sm:block">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">VOLATILITY (VIX)</span>
                    <div className="text-5xl font-black mono text-sky-400">{marketData.vix.toFixed(2)}</div>
                  </div>
                </div>
                <div className="relative h-80">
                  <MarketChart data={marketData.history} symbol={selectedSymbol} signals={signalHistory} levels={marketData.levels} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-6 pt-8 border-t border-slate-800/50">
                  {[{k: 'WEEKLY HP', v: marketData.levels?.hp}, {k: 'MONTHLY HP', v: marketData.levels?.mhp}, {k: 'GAMMA FLIP', v: marketData.levels?.gammaFlip}, {k: 'VANNA PIVOT', v: marketData.levels?.vannaPivot}].map(item => (
                    <div key={item.k} className="space-y-1.5">
                      <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">{item.k}</span>
                      <div className="text-sm font-mono font-bold text-white tracking-tight">${item.v?.toFixed(2)}</div>
                      <div className="h-0.5 w-8 bg-slate-800 rounded-full" />
                    </div>
                  ))}
                  <div className={`space-y-1.5 p-2 rounded-xl border transition-all duration-700 ${isGoldenFlow ? 'bg-amber-500/10 border-amber-500/40' : 'bg-slate-900/40 border-slate-800/40'}`}>
                    <span className={`text-[9px] font-black uppercase tracking-widest block ${isGoldenFlow ? 'text-amber-500' : 'text-slate-500'}`}>FLOW INTENSITY</span>
                    <div className={`text-sm font-mono font-black tracking-tight ${isGoldenFlow ? 'text-amber-400' : 'text-sky-400'}`}>{currentLixi.toFixed(2)}</div>
                    <div className={`h-1 w-full rounded-full overflow-hidden ${isGoldenFlow ? 'bg-amber-500/20' : 'bg-slate-800'}`}>
                      <div className={`h-full transition-all duration-1000 ${isGoldenFlow ? 'bg-amber-500' : 'bg-sky-500'}`} style={{ width: `${Math.min(currentLixi * 10, 100)}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-96 flex flex-col items-center justify-center gap-8 opacity-20"><ICONS.Activity size={100} /></div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            <div className="glass-effect p-8 rounded-[2rem] border border-slate-800/40">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-6">Ensemble Insights</h3>
              {analysis?.signal.ensembleInsights ? (
                <div className="space-y-5">
                  {analysis.signal.ensembleInsights.map(insight => (
                    <div key={insight.category} className="space-y-2">
                      <div className="flex justify-between text-[10px] font-black uppercase">
                        <span className="text-slate-400 tracking-wider">{insight.category}</span>
                        <span className={insight.sentiment === 'BULLISH' ? 'text-emerald-400' : 'text-rose-400'}>{insight.sentiment}</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800/30">
                        <div className={`h-full transition-all duration-1000 ${insight.sentiment === 'BULLISH' ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${insight.weight}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div className="h-32 flex items-center justify-center opacity-5"><ICONS.Activity size={32} /></div>}
            </div>
            <div className="glass-effect p-8 rounded-[2rem] border border-slate-800/40 flex flex-col justify-center text-center relative group">
              <div className={`absolute inset-0 transition-all ${isGoldenFlow ? 'bg-amber-500/[0.04]' : 'bg-sky-500/[0.02] group-hover:bg-sky-500/[0.05]'}`} />
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] mb-3 block">Neural Posture</span>
              <div className={`text-5xl font-black italic tracking-tighter tabular-nums ${analysis?.signal.executionStatus === 'RISK ON' ? 'text-emerald-400 text-glow-emerald' : 'text-slate-600'}`}>{analysis?.signal.executionStatus || 'STANDBY'}</div>
              <p className="text-[9px] text-slate-500 mt-4 uppercase font-black tracking-widest font-mono">Zero Latency Monitoring</p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3">
          <div className={`glass-effect rounded-[2.5rem] p-9 border-l-[6px] transition-all duration-1000 h-full flex flex-col shadow-2xl relative ${oracleReady ? (analysis?.signal.type === 'BUY' ? 'border-emerald-500 shadow-[0_0_40px_rgba(16,185,129,0.1)]' : analysis?.signal.type === 'SELL' ? 'border-rose-500 shadow-[0_0_40px_rgba(244,63,94,0.1)]' : 'border-sky-500') : 'border-slate-800'}`}>
            <div className="flex justify-between items-start mb-12">
              <div className="space-y-1.5">
                <h2 className="text-3xl font-black uppercase tracking-tighter">Neural Vote</h2>
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Institutional Edge</span>
              </div>
              <button onClick={runAnalysis} disabled={loading || !oracleReady || fetchingData} className={`p-6 rounded-2xl transition-all duration-300 active:scale-90 ${oracleReady && !fetchingData ? 'bg-sky-500 text-white shadow-[0_20px_40px_rgba(14,165,233,0.3)] hover:rotate-3' : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}>
                <ICONS.Zap size={28} className={loading ? 'animate-pulse' : ''} />
              </button>
            </div>
            {analysis ? (
              <div className="space-y-10 flex-1 animate-in slide-in-from-right-8 duration-700">
                <div className="text-center space-y-2">
                  <span className={`text-9xl font-black mono tracking-tighter tabular-nums leading-none ${analysis.signal.voteCount >= 85 ? 'text-emerald-400 text-glow-emerald' : 'text-sky-400'}`}>{analysis.signal.voteCount}</span>
                  <div className="text-[11px] font-black uppercase text-slate-500 tracking-[0.4em]">Model Consensus</div>
                </div>
                <div className="bg-slate-950/60 p-7 rounded-[2rem] border border-slate-800 space-y-6 shadow-inner">
                   {[{l: 'ENTRY POINT', v: analysis.signal.entry}, {l: 'STOP PROTECT', v: analysis.signal.stopLoss}, {l: 'TAKE PROFIT', v: analysis.signal.takeProfit}].map(item => (
                     <div key={item.l} className="flex justify-between items-center border-b border-slate-900 pb-4 last:border-0 last:pb-0">
                       <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{item.l}</span>
                       <span className="text-base font-mono font-black text-white tracking-tight">${item.v.toFixed(2)}</span>
                     </div>
                   ))}
                </div>
                <div className="p-7 bg-slate-900/30 rounded-[2rem] border border-dashed border-slate-800 relative group">
                  <ICONS.Info size={14} className="absolute top-4 right-4 text-slate-700" />
                  <p className="text-[12px] text-slate-400 font-mono italic leading-relaxed">"{analysis.signal.reasoning}"</p>
                </div>
              </div>
            ) : <div className="flex-1 flex flex-col items-center justify-center opacity-5 gap-4 pt-10"><ICONS.Activity size={100} /><p className="text-[10px] font-black uppercase tracking-[0.5em]">Oracle Idle</p></div>}
          </div>
        </div>
      </div>

      {showVault && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-6 bg-slate-950/98 backdrop-blur-3xl" onClick={() => setShowVault(false)}>
          <div className="glass-effect rounded-[3rem] p-12 border border-slate-700/40 max-w-md w-full relative z-10 shadow-[0_0_150px_rgba(0,0,0,0.8)]" onClick={e => e.stopPropagation()}>
            <div className="mb-10 text-center">
              <h3 className="text-4xl font-black text-white tracking-tighter uppercase mb-2">Quant Bridge</h3>
              <p className="text-[10px] text-slate-500 uppercase font-black tracking-[0.3em]">Institutional Feed Configuration</p>
            </div>
            <div className="space-y-8">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Tradier Access Token</label>
                <input type="password" value={inputToken} onChange={(e) => setInputToken(e.target.value)} className="w-full bg-slate-900/80 border border-slate-800 rounded-2xl px-6 py-5 text-sm text-sky-400 outline-none focus:border-sky-500/50 transition-all font-mono" placeholder="Bearer..." />
              </div>
              <button onClick={() => setIsSandbox(!isSandbox)} className="w-full flex justify-between items-center p-6 bg-slate-900 rounded-2xl border border-slate-800 group hover:border-slate-700 transition-all">
                <div className="text-left">
                  <span className="text-[11px] font-black uppercase text-slate-200 block">Sandbox Pipeline</span>
                  <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Simulated Data</span>
                </div>
                <div className={`w-14 h-7 rounded-full p-1.5 transition-all duration-500 ${isSandbox ? 'bg-sky-500 shadow-[0_0_15px_rgba(14,165,233,0.5)]' : 'bg-slate-700'}`}><div className={`w-4 h-4 bg-white rounded-full transition-all duration-500 ${isSandbox ? 'translate-x-7' : ''}`} /></div>
              </button>
              <button onClick={handleSaveToken} className="w-full bg-sky-500 hover:bg-sky-400 text-white font-black py-6 rounded-2xl shadow-[0_20px_40px_rgba(14,165,233,0.3)] uppercase tracking-[0.3em] text-[12px] transition-all active:scale-95">Open Institutional Pipe</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
