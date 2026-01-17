
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MarketData, AnalysisResponse, HistoricalSignal, PricePoint, Tick, TickWindow, TickLabel, InstitutionalLevels } from './types';
import { SYMBOLS, ICONS } from './constants';
import { analyzeMarket, fetchMarketDataViaSearch } from './services/geminiService';
import { TradierService } from './services/tradierService';
import MarketChart from './components/MarketChart';

const formatToEST = (date: Date) => {
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
};

type StreamingStatus = 'IDLE' | 'AUTH_REQUIRED' | 'MARKET_CLOSED' | 'CONNECTING' | 'LIVE' | 'SIMULATING' | 'ERROR';

const App: React.FC = () => {
  const [selectedSymbol, setSelectedSymbol] = useState(SYMBOLS[0]);
  const [isTradierConnected, setIsTradierConnected] = useState(false);
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingData, setFetchingData] = useState(false);
  const [apiError, setApiError] = useState<'QUOTA' | 'SEARCH_QUOTA' | 'FETCH' | 'ANALYSIS' | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [showVault, setShowVault] = useState(false);
  const [isEditingPivots, setIsEditingPivots] = useState(false);
  const [inputToken, setInputToken] = useState('');
  const [isSandbox, setIsSandbox] = useState(false);
  const [signalHistory, setSignalHistory] = useState<HistoricalSignal[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);

  const [streamingStatus, setStreamingStatus] = useState<StreamingStatus>('IDLE');
  const [tickBuffer, setTickBuffer] = useState<Tick[]>([]);
  const [windowHistory, setWindowHistory] = useState<TickWindow[]>([]);
  const [lastProcessedMid, setLastProcessedMid] = useState<number>(0);
  const [tickHeartbeat, setTickHeartbeat] = useState(0);
  const [windowsSinceRetrain, setWindowsSinceRetrain] = useState(0);
  
  const tradierRef = useRef<TradierService | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const simIntervalRef = useRef<number | null>(null);
  const fetchAbortController = useRef<AbortController | null>(null);

  const handleNewTickRef = useRef<(tick: Tick) => void>(() => {});

  const checkGeminiKey = async () => {
    try {
      const hasKey = await (window as any).aistudio.hasSelectedApiKey();
      setHasGeminiKey(hasKey);
    } catch (e) {
      setHasGeminiKey(false);
    }
  };

  const handleSelectGeminiKey = async () => {
    try {
      await (window as any).aistudio.openSelectKey();
      setHasGeminiKey(true); // Proceed assuming success per race condition mitigation
    } catch (e) {
      console.error("Key selection failed");
    }
  };

  const handleNewTick = useCallback((tick: Tick) => {
    setTickBuffer(prev => {
      const newBuffer = [...prev, tick];
      if (newBuffer.length >= 5) {
        const service = tradierRef.current || new TradierService("");
        const window = service.calculateWindowLabel(newBuffer, lastProcessedMid || tick.mid);
        setLastProcessedMid(window.meanMid);
        setWindowHistory(wh => [window, ...wh].slice(0, 20));
        setWindowsSinceRetrain(ws => ws + 1);
        return [];
      }
      return newBuffer;
    });
  }, [lastProcessedMid]);

  useEffect(() => {
    handleNewTickRef.current = handleNewTick;
  }, [handleNewTick]);

  const fetchData = useCallback(async () => {
    if (!hasGeminiKey) return;
    if (fetchAbortController.current) fetchAbortController.current.abort();
    fetchAbortController.current = new AbortController();
    setFetchingData(true);
    setApiError(null);
    
    try {
      const searchMeta = await fetchMarketDataViaSearch(selectedSymbol);
      const hp = searchMeta.hp || 0;
      const mhp = searchMeta.mhp || 0;
      const gf = searchMeta.gammaFlip || 0;
      const mg = searchMeta.maxGamma || 0;
      const vp = searchMeta.vannaPivot || 0;
      const hg = (searchMeta.yesterdayClose && searchMeta.todayOpen) ? (searchMeta.yesterdayClose + searchMeta.todayOpen) / 2 : 0;
      
      let bias: any = 'NEUTRAL';
      if (hp === mhp && hp !== 0) bias = 'SQUEEZE';
      else if (hp > mhp) bias = 'BULLISH';
      else if (mhp > hp) bias = 'BEARISH';

      let history: PricePoint[] = [];
      if (isTradierConnected && tradierRef.current) {
        try {
          const h = await tradierRef.current.getIntradayHistory(selectedSymbol);
          history = h.map((bar: any) => ({ time: formatToEST(new Date(bar.time || bar.date)), price: bar.close || bar.price, volume: bar.volume }));
        } catch (e) {
          history = (searchMeta.history || []).map((h: any) => ({ time: h.time, price: h.price, volume: 0 }));
        }
      } else {
        history = (searchMeta.history || []).map((h: any) => ({ time: h.time, price: h.price, volume: 0 }));
      }

      setMarketData({
        symbol: selectedSymbol,
        currentPrice: searchMeta.currentPrice || 0,
        change24h: searchMeta.change24h || 0,
        volume24h: 0, vix: searchMeta.vix || 15, history, 
        levels: { hp, mhp, hg, gammaFlip: gf, maxGamma: mg, vannaPivot: vp, bias }
      });
    } catch (e: any) { 
      if (e.name === 'AbortError') return;
      setApiError('SEARCH_QUOTA');
      const seedPrice = selectedSymbol === 'SPY' ? 598.42 : 508.15;
      setMarketData(prev => ({
        symbol: selectedSymbol,
        currentPrice: prev?.currentPrice || seedPrice,
        change24h: 0.45, volume24h: 0, vix: 14.80,
        history: prev?.history || [{ time: '09:30', price: seedPrice - 1.5, volume: 0 }, { time: '15:30', price: seedPrice, volume: 0 }],
        levels: prev?.levels || { hp: seedPrice * 1.01, mhp: seedPrice * 1.02, hg: seedPrice, gammaFlip: seedPrice, maxGamma: seedPrice * 1.015, vannaPivot: seedPrice * 0.99, bias: 'NEUTRAL' }
      }));
    } finally { setFetchingData(false); }
  }, [selectedSymbol, isTradierConnected, hasGeminiKey]);

  useEffect(() => {
    checkGeminiKey();
    const savedToken = localStorage.getItem('TRADIER_TOKEN');
    const savedSandbox = localStorage.getItem('TRADIER_SANDBOX') === 'true';
    if (savedToken) {
      tradierRef.current = new TradierService(savedToken, savedSandbox);
      setIsTradierConnected(true);
      setIsSandbox(savedSandbox);
      setInputToken(savedToken);
    } else {
      setIsSimulating(true);
    }
  }, []);

  useEffect(() => {
    setWindowHistory([]);
    setTickBuffer([]);
    setAnalysis(null);
    setLastProcessedMid(0);
    if (hasGeminiKey) fetchData();
  }, [selectedSymbol, hasGeminiKey]);

  useEffect(() => {
    if (isSimulating) {
      setStreamingStatus('SIMULATING');
      simIntervalRef.current = window.setInterval(() => {
        setMarketData(prev => {
          if (!prev) return null;
          const drift = (Math.random() - 0.48) * 0.05; 
          const newPrice = prev.currentPrice + drift;
          const mockTick: Tick = { time: Date.now(), bid: newPrice - 0.01, ask: newPrice + 0.01, last: newPrice, mid: newPrice, spread: 0.02, volume: 100, bidVolume: 50, askVolume: 50 };
          handleNewTickRef.current(mockTick);
          setTickHeartbeat(h => h + 1);
          return { ...prev, currentPrice: newPrice };
        });
      }, 1000);
    } else if (isTradierConnected && !wsRef.current) {
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
      startStream();
    }
    return () => { if (simIntervalRef.current) clearInterval(simIntervalRef.current); };
  }, [isSimulating, isTradierConnected]);

  const startStream = async () => {
    if (!tradierRef.current) return;
    setStreamingStatus('CONNECTING');
    try {
      const sessionId = await tradierRef.current.createStreamSession();
      const ws = new WebSocket(`wss://ws.tradier.com/v1/markets/events`);
      ws.onopen = () => {
        setStreamingStatus('LIVE');
        ws.send(JSON.stringify({ symbols: [selectedSymbol], sessionid: sessionId, filter: ["quote"], linebreak: true }));
      };
      ws.onmessage = (e) => {
        const raw = JSON.parse(e.data);
        if (raw.type === 'quote' && raw.symbol === selectedSymbol) {
          const tick = tradierRef.current?.cleanAndProcessTick(raw);
          if (tick) {
            handleNewTickRef.current(tick);
            setTickHeartbeat(h => h + 1);
            setMarketData(prev => prev ? ({ ...prev, currentPrice: tick.mid }) : null);
          }
        }
      };
      wsRef.current = ws;
    } catch (e) { setStreamingStatus('ERROR'); }
  };

  const runAnalysis = useCallback(async () => {
    if (!marketData || windowHistory.length === 0 || loading) return;
    setLoading(true);
    try {
      const result = await analyzeMarket(marketData, windowHistory);
      setAnalysis(result);
      setLastUpdate(new Date());
      setSignalHistory(prev => [{
        ...result.signal, id: crypto.randomUUID(), symbol: marketData.symbol, timestamp: new Date().toISOString(),
        chartTime: formatToEST(new Date()), priceAtSignal: marketData.currentPrice,
        liquidityZone: result.signal.isGoldenSetup ? 'GOLDEN SETUP' : result.signal.liquidityZone || 'NEUTRAL ZONE'
      }, ...prev].slice(0, 50));
    } catch (e: any) { setApiError('ANALYSIS'); } finally { setLoading(false); }
  }, [marketData, windowHistory, loading]);

  const handleSaveToken = () => {
    localStorage.setItem('TRADIER_TOKEN', inputToken);
    localStorage.setItem('TRADIER_SANDBOX', isSandbox.toString());
    tradierRef.current = new TradierService(inputToken, isSandbox);
    setIsTradierConnected(true);
    setIsSimulating(false);
    setShowVault(false);
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    startStream();
  };

  const oracleReady = marketData && windowHistory.length > 0;
  const tickProgress = (tickBuffer.length / 5) * 100;

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto space-y-4 md:space-y-6 relative overflow-hidden bg-[#020617] text-[#f8fafc]">
      <div className="fixed top-[-10%] right-[-10%] w-[500px] h-[500px] bg-sky-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Nav Matrix */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4 px-4 md:px-8 py-3 bg-slate-900/60 backdrop-blur-xl rounded-2xl md:rounded-3xl border border-slate-800 w-full relative z-[100] shadow-2xl justify-between">
        <div className="flex items-center justify-between md:justify-start gap-4 md:gap-6">
          <div className="flex flex-col">
             <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${streamingStatus === 'LIVE' ? 'bg-emerald-500 animate-pulse' : 'bg-sky-500 animate-pulse'}`} />
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                  {streamingStatus === 'SIMULATING' ? 'SYNTHETIC_DATA' : 'INSTITUTIONAL_FEED'}
                </span>
             </div>
          </div>
          <div className="h-6 w-px bg-slate-800 hidden md:block" />
          <div className="flex flex-col flex-1 md:flex-none">
             <div className="flex items-center gap-2 justify-end md:justify-start">
                <div className="w-16 md:w-24 h-1 bg-slate-800 rounded-full overflow-hidden">
                   <div className="h-full bg-sky-500 transition-all duration-300" style={{ width: `${Math.min(windowsSinceRetrain, 100)}%` }} />
                </div>
                <span className="text-[9px] font-mono font-bold text-sky-400 shrink-0">{windowsSinceRetrain}%</span>
             </div>
          </div>
        </div>

        <div className="flex items-center justify-between md:justify-center gap-3">
           <div className="flex items-center gap-2">
              <button onClick={() => setShowVault(true)} className={`px-4 py-2 bg-slate-950/60 hover:bg-slate-800/80 rounded-xl border transition-all active:scale-95 flex items-center gap-2 text-[9px] font-black uppercase tracking-widest ${!hasGeminiKey ? 'border-sky-500/50 shadow-[0_0_10px_#0ea5e933] animate-pulse' : 'border-slate-700'}`}>
                <ICONS.Shield size={10} className={hasGeminiKey ? 'text-emerald-400' : 'text-sky-400'} />
                <span>Vault</span>
              </button>
           </div>
        </div>
      </div>

      <header className="flex flex-col md:flex-row justify-between items-center gap-4 md:border-b md:border-slate-900 md:pb-6 relative z-10">
        <div className="space-y-1 text-center md:text-left">
          <h1 className="text-2xl md:text-4xl font-black tracking-tighter neon-text-blue flex items-center justify-center md:justify-start gap-2 md:gap-3">
            <ICONS.Activity className="text-sky-400 w-6 h-6 md:w-8 md:h-8" />
            AETHER <span className="font-light text-slate-500 uppercase">Quant</span>
          </h1>
          <p className="text-[8px] md:text-[9px] font-black uppercase tracking-[0.4em] text-slate-600">Elastic Net Ensemble v2.9.2</p>
        </div>
        <div className="flex w-full md:w-auto bg-slate-950/80 backdrop-blur p-1 rounded-xl border border-slate-800 shadow-xl">
          {SYMBOLS.map(symbol => (
            <button key={symbol} onClick={() => setSelectedSymbol(symbol)} className={`flex-1 md:flex-none px-6 md:px-8 py-2 md:py-2.5 rounded-lg transition-all text-[10px] md:text-xs font-bold tracking-widest uppercase ${selectedSymbol === symbol ? 'bg-sky-500 text-white shadow-2xl scale-[1.02]' : 'text-slate-500 hover:text-slate-300'}`}>{symbol}</button>
          ))}
        </div>
      </header>

      <div key={selectedSymbol} className="grid grid-cols-1 lg:grid-cols-4 gap-4 md:gap-8 relative z-10">
        <div className="lg:col-span-1 order-3 lg:order-1">
           <div className="glass-effect rounded-2xl md:rounded-3xl p-4 md:p-6 border border-slate-800/50 flex flex-col h-[350px] lg:h-full lg:max-h-[600px] shadow-2xl overflow-hidden relative">
              <div className="absolute top-4 md:top-6 right-4 md:right-6 flex items-center gap-1.5">
                 <div key={tickHeartbeat} className="w-1 h-1 md:w-1.5 md:h-1.5 rounded-full bg-sky-500 animate-ping" />
                 <span className="text-[7px] text-slate-600 font-mono uppercase tracking-tighter">TICKS:{tickBuffer.length}/5</span>
              </div>
              <h3 className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-4 md:mb-6">HFT Predictors</h3>
              <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-hide">
                {windowHistory.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center opacity-40 py-10 space-y-3">
                     <ICONS.Activity size={24} className="text-sky-500 animate-pulse" />
                     <div className="space-y-1">
                       <p className="text-[8px] uppercase font-mono tracking-widest text-sky-400">Collecting Data</p>
                       <div className="w-20 h-1 bg-slate-800 rounded-full mx-auto overflow-hidden">
                         <div className="h-full bg-sky-500 transition-all duration-500" style={{ width: `${tickProgress}%` }} />
                       </div>
                     </div>
                  </div>
                ) : windowHistory.map(win => (
                  <div key={win.id} className="bg-slate-950/50 border border-slate-900 p-3 rounded-lg space-y-2 border-l-2 border-l-sky-500">
                     <div className="flex justify-between items-center text-[7px] font-mono">
                        <span className="text-slate-500">{win.timestamp}</span>
                        <span className={`font-black px-1.5 py-0.5 rounded ${win.label === TickLabel.UPWARDS ? 'text-emerald-400 bg-emerald-500/10' : win.label === TickLabel.DOWNWARDS ? 'text-rose-400 bg-rose-500/10' : 'text-slate-500'}`}>{win.label}</span>
                     </div>
                     <div className="grid grid-cols-2 gap-2">
                        <div className="bg-slate-900/50 p-1.5 rounded-lg border border-slate-800 text-center"><span className="text-[7px] text-sky-400 font-mono font-bold">LIXI: {win.lixi.toFixed(1)}</span></div>
                        <div className="bg-slate-900/50 p-1.5 rounded-lg border border-slate-800 text-center"><span className="text-[7px] text-sky-400 font-mono font-bold">ASK: {win.features.v14_ask_vol}</span></div>
                     </div>
                  </div>
                ))}
              </div>
           </div>
        </div>

        <div className="lg:col-span-2 space-y-4 md:space-y-8 order-1 lg:order-2">
          <div className="glass-effect rounded-2xl md:rounded-3xl p-5 md:p-8 border border-sky-500/20 shadow-2xl relative overflow-hidden h-[300px] md:h-[450px]">
            {marketData ? (
              <>
                <div className="flex justify-between items-end mb-6 relative z-10">
                  <div className="space-y-0.5 md:space-y-1">
                    <span className="text-slate-500 text-[8px] md:text-[10px] font-mono uppercase tracking-[0.3em]">{selectedSymbol} SPOT</span>
                    <div className="text-3xl md:text-5xl font-black mono text-white tracking-tighter">${marketData.currentPrice.toFixed(2)}</div>
                    <div className={`text-xs font-bold flex items-center gap-1 ${marketData.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{marketData.change24h.toFixed(2)}%</div>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-500 text-[8px] md:text-[10px] font-mono uppercase tracking-[0.3em]">VIX</span>
                    <div className="text-xl md:text-3xl font-bold mono text-sky-400">{marketData.vix.toFixed(2)}</div>
                  </div>
                </div>
                <MarketChart data={marketData.history} symbol={selectedSymbol} signals={signalHistory} levels={marketData.levels} />
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center space-y-4">
                 <div className="w-12 h-12 border-4 border-sky-500/20 border-t-sky-500 rounded-full animate-spin" />
                 <p className="text-[10px] uppercase font-black text-slate-500 tracking-widest">Waking Oracle...</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             <div className="glass-effect p-6 rounded-3xl border border-slate-800 shadow-xl">
                <h3 className="text-[9px] text-slate-500 uppercase tracking-widest font-black mb-4">Institutional Pivots</h3>
                <div className="grid grid-cols-1 gap-2">
                   {[
                     { label: 'Gamma Flip', key: 'gammaFlip', color: 'text-cyan-400' },
                     { label: 'Vanna Pivot', key: 'vannaPivot', color: 'text-pink-400' },
                     { label: 'Max Gamma', key: 'maxGamma', color: 'text-emerald-400' }
                   ].map(lvl => (
                    <div key={lvl.key} className="flex justify-between items-center border-b border-slate-900 pb-1.5">
                      <span className="text-[8px] text-slate-600 uppercase font-bold">{lvl.label}</span>
                      <span className={`text-[11px] font-mono font-bold ${lvl.color}`}>${(marketData?.levels as any)?.[lvl.key]?.toFixed(2) || '---'}</span>
                    </div>
                   ))}
                </div>
             </div>
             <div className={`glass-effect p-6 rounded-3xl border transition-all duration-700 shadow-xl flex flex-col justify-center text-center space-y-2 ${analysis?.signal.executionStatus === 'RISK ON' ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-slate-800'}`}>
                <h3 className="text-[9px] text-slate-500 uppercase tracking-widest font-black">Execution State</h3>
                <div className={`text-xl font-black italic tracking-tighter ${analysis?.signal.executionStatus === 'RISK ON' ? 'text-emerald-400 animate-pulse' : 'text-slate-600'}`}>
                   {analysis?.signal.executionStatus || 'DORMANT'}
                </div>
             </div>
          </div>
        </div>

        <div className="lg:col-span-1 order-2 lg:order-3">
          <div className={`glass-effect rounded-2xl md:rounded-3xl p-6 md:p-8 border-l-[4px] md:border-l-[6px] transition-all duration-500 h-full flex flex-col shadow-2xl relative overflow-hidden ${oracleReady ? 'border-sky-500' : 'border-slate-800'}`}>
            <div className="flex justify-between items-center mb-6 relative z-10">
               <div className="flex flex-col">
                 <h2 className="text-lg md:text-xl font-black text-white tracking-tighter uppercase">ENet Oracle</h2>
                 {!hasGeminiKey && <span className="text-[7px] text-rose-500 font-black animate-pulse">KEY REQUIRED</span>}
               </div>
               {hasGeminiKey ? (
                <button onClick={runAnalysis} disabled={loading || !oracleReady} className={`p-3 rounded-2xl transition-all active:scale-90 shadow-lg relative overflow-hidden group ${oracleReady ? 'bg-sky-500 hover:bg-sky-400 text-white shadow-[0_0_15px_#0ea5e966]' : 'bg-slate-800 text-slate-600'}`}>
                  <ICONS.Activity size={20} className={loading ? 'animate-spin' : ''} />
                </button>
               ) : (
                <button onClick={handleSelectGeminiKey} className="p-3 bg-rose-500 hover:bg-rose-400 rounded-2xl transition-all active:scale-90 shadow-lg text-white">
                  <ICONS.Zap size={20} />
                </button>
               )}
            </div>

            {loading ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4 py-10">
                 <div className="w-10 h-10 border-4 border-sky-500 border-t-transparent rounded-full animate-spin shadow-[0_0_15px_#0ea5e9]" />
                 <p className="text-[9px] text-slate-500 font-mono uppercase tracking-[0.2em]">Ensemble Voting...</p>
              </div>
            ) : analysis ? (
              <div className="space-y-4 md:space-y-6 flex-1 relative z-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
                 <div className={`p-4 md:p-6 rounded-xl md:rounded-2xl border text-center space-y-2 shadow-inner transition-all duration-500 ${analysis.signal.voteCount >= 70 ? (analysis.signal.type === 'BUY' ? 'bg-emerald-500/10 border-emerald-500/40 shadow-[0_0_20px_#10b9811a]' : (analysis.signal.type === 'SELL' ? 'bg-rose-500/10 border-rose-500/40 shadow-[0_0_20px_#f43f5e1a]' : 'bg-slate-950/80 border-slate-800')) : 'bg-slate-950/80 border-slate-800'}`}>
                    <span className="text-[9px] text-slate-600 uppercase tracking-widest font-black block">Consensus Confidence</span>
                    <span className={`text-3xl md:text-4xl font-black mono tracking-tighter transition-colors duration-500 ${analysis.signal.voteCount >= 70 ? (analysis.signal.type === 'BUY' ? 'text-emerald-400' : (analysis.signal.type === 'SELL' ? 'text-rose-400' : 'text-sky-400')) : 'text-sky-400'}`}>
                      {analysis.signal.voteCount}/100
                    </span>
                    <div className="w-full bg-slate-900 h-1.5 rounded-full mt-2 overflow-hidden border border-slate-800 relative">
                       <div className={`h-full transition-all duration-1000 ${analysis.signal.voteCount >= 70 ? (analysis.signal.type === 'BUY' ? 'bg-emerald-500' : (analysis.signal.type === 'SELL' ? 'bg-rose-500' : 'bg-sky-500')) : 'bg-sky-500'}`} style={{ width: `${analysis.signal.voteCount}%` }} />
                    </div>
                 </div>
                 <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 shadow-inner relative">
                    <div className="flex justify-between items-center pb-2 border-b border-slate-900 text-[9px]">
                       <span className="text-slate-600 uppercase font-black">Entry</span>
                       <span className="font-bold mono text-white">${(analysis.signal.entry || 0).toFixed(2)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                       <div className="bg-rose-500/5 p-2 rounded-lg border border-rose-500/10 text-center"><span className="text-[7px] text-rose-500 block uppercase mb-1">Stop</span><span className="text-[10px] font-bold text-rose-500">${(analysis.signal.stopLoss || 0).toFixed(2)}</span></div>
                       <div className="bg-emerald-500/5 p-2 rounded-lg border border-emerald-500/10 text-center"><span className="text-[7px] text-emerald-400 block uppercase mb-1">Target</span><span className="text-[10px] font-bold text-emerald-400">${(analysis.signal.takeProfit || 0).toFixed(2)}</span></div>
                    </div>
                 </div>
                 <p className="text-[10px] md:text-[11px] leading-relaxed italic font-mono p-4 rounded-xl border border-dashed border-slate-800 text-slate-400">"{analysis.signal.reasoning}"</p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-600 py-10 relative z-10 space-y-4">
                 <ICONS.Shield size={48} className={oracleReady ? 'text-sky-400' : 'text-slate-800'} />
                 <div className="text-center space-y-2 w-full max-w-[180px]">
                   <p className="text-[9px] uppercase tracking-[0.4em] font-black">{oracleReady ? 'READY FOR INFERENCE' : (hasGeminiKey ? 'COLLECTING TICKS' : 'SYSTEM LOCKED')}</p>
                   {!hasGeminiKey ? (
                     <button onClick={handleSelectGeminiKey} className="text-[8px] text-sky-400 font-black uppercase underline tracking-widest">Connect Gemini Key</button>
                   ) : !oracleReady && (
                     <div className="w-full bg-slate-900 h-1 rounded-full overflow-hidden"><div className="h-full bg-sky-500 transition-all duration-500" style={{ width: `${tickProgress}%` }} /></div>
                   )}
                 </div>
              </div>
            )}
            <div className="mt-8 pt-4 flex justify-between text-[7px] text-slate-700 font-black uppercase tracking-widest font-mono border-t border-slate-900/50">
               <span>QUANT_OS_v2.9.2</span>
               <span className="text-sky-500">{lastUpdate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Vault Modal */}
      {showVault && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md" onClick={() => setShowVault(false)} />
          <div className="glass-effect rounded-3xl p-8 border border-slate-700 max-w-md w-full relative z-10 shadow-2xl">
            <h3 className="text-xl font-black text-white tracking-tighter uppercase mb-2">Tradier Vault</h3>
            <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mb-6">Institutional Data Feed</p>
            <div className="space-y-6">
              <div className="space-y-3">
                <label className="text-[9px] font-black uppercase text-slate-400 tracking-[0.2em] flex items-center gap-2"><ICONS.Shield size={10} className="text-sky-500" /> Access Token</label>
                <input type="password" value={inputToken} onChange={(e) => setInputToken(e.target.value)} className="w-full bg-slate-900/80 border border-slate-800 rounded-xl px-4 py-4 text-sm text-sky-400 outline-none focus:border-sky-500/50 transition-all font-mono" placeholder="********************************" />
              </div>
              <div className="flex items-center justify-between bg-slate-900/50 p-4 rounded-xl border border-slate-800">
                <div className="flex items-center gap-3">
                  <button onClick={() => setIsSandbox(!isSandbox)} className={`w-10 h-5 rounded-full p-1 transition-all ${isSandbox ? 'bg-sky-500' : 'bg-slate-700'}`}>
                     <div className={`w-3 h-3 bg-white rounded-full transition-all ${isSandbox ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                  <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Sandbox Account</span>
                </div>
              </div>
              <div className="pt-4 border-t border-slate-800">
                 <button onClick={handleSelectGeminiKey} className={`w-full py-4 px-4 rounded-xl border flex items-center justify-between transition-all ${hasGeminiKey ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5' : 'border-sky-500 text-sky-400 bg-sky-500/5'}`}>
                   <span className="text-[10px] font-black uppercase tracking-widest">Ensemble API Key</span>
                   <span className="text-[8px] font-mono">{hasGeminiKey ? 'CONNECTED' : 'SELECT KEY'}</span>
                 </button>
              </div>
              <button onClick={handleSaveToken} className="w-full bg-sky-500 hover:bg-sky-400 text-white font-black py-5 rounded-xl shadow-lg transition-all active:scale-[0.98] uppercase tracking-[0.2em] text-xs">
                Sync Aether Feed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
