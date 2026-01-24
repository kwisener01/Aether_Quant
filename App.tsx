
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MarketData, AnalysisResponse, HistoricalSignal, PricePoint, Tick, TickWindow, TickLabel, PropChallengeStats, Alert, SentimentAnalysis } from './types';
import { SYMBOLS, ICONS } from './constants';
import { analyzeMarket, fetchMarketDataViaSearch, fetchSentimentAnalysis } from './services/geminiService';
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
  try {
    return date.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  } catch (e) {
    return date.toLocaleTimeString();
  }
};

const isMarketOpen = () => {
  try {
    const now = new Date();
    const estDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = estDate.getDay();
    const hour = estDate.getHours();
    const min = estDate.getMinutes();
    if (day === 0 || day === 6) return false;
    const timeInMins = hour * 60 + min;
    return timeInMins >= 570 && timeInMins <= 960; // 9:30 AM to 4:00 PM
  } catch (e) {
    return true; // Default to open if TZ check fails
  }
};

type StreamingStatus = 'IDLE' | 'TRADIER_PRO' | 'GROUNDED' | 'OFFLINE' | 'TIMEOUT' | 'ERROR';

const App: React.FC = () => {
  const [selectedSymbol, setSelectedSymbol] = useState(SYMBOLS[0]);
  const [isTradierConnected, setIsTradierConnected] = useState(false);
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [sentiment, setSentiment] = useState<SentimentAnalysis | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingData, setFetchingData] = useState(false);
  const [showVault, setShowVault] = useState(false);
  const [inputToken, setInputToken] = useState('');
  const [isSandbox, setIsSandbox] = useState(false);
  const [signalHistory, setSignalHistory] = useState<HistoricalSignal[]>([]);
  const [streamingStatus, setStreamingStatus] = useState<StreamingStatus>('IDLE');
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

  const currentLixi = windowHistory.length > 0 ? (windowHistory[0].lixi || 0) : 0;
  const isGoldenFlow = currentLixi > 7.5;
  const marketLive = isMarketOpen();

  const addAlert = useCallback((type: Alert['type'], message: string) => {
    const newAlert: Alert = { id: generateSafeId(), type, message, timestamp: new Date().toLocaleTimeString() };
    setAlerts(prev => [newAlert, ...prev].slice(0, 5));
    setTimeout(() => {
      setAlerts(prev => prev.filter(a => a.id !== newAlert.id));
    }, 8000);
  }, []);

  const fetchData = useCallback(async (forceSymbol?: string) => {
    const symbol = forceSymbol || selectedSymbol;
    if (fetchLock.current) return;
    
    fetchLock.current = true;
    setFetchingData(true);
    
    try {
      let historyPoints: PricePoint[] = [];
      let dataSource: StreamingStatus = 'GROUNDED';
      let currentPrice = 0;

      const [searchMeta, sentimentMeta] = await Promise.all([
        fetchMarketDataViaSearch(symbol),
        fetchSentimentAnalysis(symbol)
      ]);

      setSentiment(sentimentMeta);

      if (tradierRef.current && isTradierConnected) {
        try {
          const [bars, quote] = await Promise.all([
            tradierRef.current.getIntradayHistory(symbol),
            tradierRef.current.getQuotes([symbol])
          ]);
          
          if (bars && bars.length > 0) {
            historyPoints = bars.map(b => ({
              time: b.date.includes(' ') ? b.date.split(' ')[1] : b.date,
              price: parseFloat(String(b.close)) || 0,
              volume: parseFloat(String(b.volume)) || 0
            }));
            dataSource = 'TRADIER_PRO';
            currentPrice = parseFloat(String(quote[0]?.last)) || (historyPoints.length > 0 ? historyPoints[historyPoints.length - 1].price : 0);
          }
        } catch (err: any) {
          dataSource = 'GROUNDED';
        }
      }
      
      if (historyPoints.length === 0) {
        historyPoints = (searchMeta.history || []).map((h: any) => ({
          time: String(h.time),
          price: parseFloat(String(h.price)) || 0,
          volume: parseFloat(String(h.volume)) || 0
        }));
      }

      if (historyPoints.length === 0 || (historyPoints.length > 0 && historyPoints[0].price === 0)) {
        setStreamingStatus('OFFLINE');
      } else {
        setStreamingStatus(dataSource);
        const service = tradierRef.current || new TradierService("");
        
        const vixValue = parseFloat(String(searchMeta.vix)) || 15;
        const baseSpread = Math.max(0.01, (vixValue / 850)); 
        const marketActive = isMarketOpen();

        const hftFeed: Tick[] = historyPoints.map((p, idx) => {
          const openingVol = marketActive ? 1.4 : 1.0;
          const noise = (Math.random() - 0.5) * (vixValue / 120) * openingVol;
          const currentSpread = baseSpread * (0.8 + Math.random() * 0.4);
          const tickVolume = (p.volume || 2500) * (0.5 + Math.random() * 1.5);
          const cycle = Math.sin(idx / 10);
          const buySellSkew = 0.5 + (cycle * 0.25) + (Math.random() * 0.1 - 0.05);

          return {
            time: Date.now() - (historyPoints.length - idx) * 60000,
            bid: (p.price + noise) - (currentSpread / 2),
            ask: (p.price + noise) + (currentSpread / 2),
            mid: p.price + noise,
            last: p.price + noise,
            spread: currentSpread,
            volume: tickVolume,
            bidVolume: tickVolume * buySellSkew,
            askVolume: tickVolume * (1 - buySellSkew)
          };
        });

        const windows: TickWindow[] = [];
        for (let i = 0; i < hftFeed.length; i += 4) {
          const chunk = hftFeed.slice(i, Math.min(i + 4, hftFeed.length));
          if (chunk.length > 0) {
            const lastMid = i === 0 ? chunk[0].mid : hftFeed[i - 1].mid;
            const win = service.calculateWindowLabel(chunk, lastMid);
            windows.push(win);
          }
        }
        
        const latestWin = windows[windows.length - 1];
        if (latestWin && latestWin.lixi > 8.5) {
          addAlert('GOLDEN', `OPENING CROSS ALERT: Institutional cluster on ${symbol}! LIXI: ${latestWin.lixi.toFixed(2)}`);
        }
        
        setWindowHistory(windows.reverse());
      }

      const hp = parseFloat(String(searchMeta.hp)) || 0;
      const mhp = parseFloat(String(searchMeta.mhp)) || 0;
      let bias: any = 'NEUTRAL';
      if (hp === mhp && hp !== 0) bias = 'SQUEEZE';
      else if (hp > mhp) bias = 'BULLISH';
      else if (mhp > hp) bias = 'BEARISH';

      setMarketData({
        symbol,
        currentPrice: currentPrice || parseFloat(String(searchMeta.currentPrice)) || (historyPoints.length > 0 ? historyPoints[historyPoints.length - 1].price : 0),
        change24h: parseFloat(String(searchMeta.change24h)) || 0,
        volume24h: 0,
        vix: parseFloat(String(searchMeta.vix)) || 15,
        history: historyPoints,
        levels: { 
          hp, mhp, 
          hg: (parseFloat(String(searchMeta.yesterdayClose)) + parseFloat(String(searchMeta.todayOpen))) / 2 || 0, 
          gammaFlip: parseFloat(String(searchMeta.gammaFlip)) || 0, 
          maxGamma: parseFloat(String(searchMeta.maxGamma)) || 0, 
          vannaPivot: parseFloat(String(searchMeta.vannaPivot)) || 0, 
          bias 
        }
      });
      setCountdown(isTradierConnected ? 30 : 60);
    } catch (e: any) {
      addAlert('SYSTEM', `Connectivity Error: Institutional pipe failure.`);
    } finally { 
      setFetchingData(false);
      fetchLock.current = false;
    }
  }, [selectedSymbol, isTradierConnected, addAlert]);

  const handleSymbolChange = (s: string) => {
    setSelectedSymbol(s);
    setMarketData(null);
    setSentiment(null);
    setWindowHistory([]);
    fetchData(s);
  };

  const runAnalysis = useCallback(async () => {
    if (!marketData || windowHistory.length === 0 || loading) return;
    setLoading(true);
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
      addAlert('SYSTEM', 'Analysis Engine Failure');
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
    
    const aistudio = (window as any).aistudio;
    if (aistudio && typeof aistudio.hasSelectedApiKey === 'function') {
      aistudio.hasSelectedApiKey().then((has: boolean) => {
        setHasGeminiKey(has);
        if (has) fetchData();
      }).catch(() => {
        setHasGeminiKey(true);
        fetchData();
      });
    } else {
      // Fallback for environments where key dialog isn't needed/available
      setHasGeminiKey(true);
      fetchData();
    }
  }, []);

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

  const getLixiIntensity = (lixi: number) => {
    if (lixi > 8.5) return 'bg-amber-500 shadow-[0_0_10px_#f59e0b]';
    if (lixi > 7.5) return 'bg-amber-400';
    if (lixi > 6.0) return 'bg-sky-500';
    if (lixi > 4.0) return 'bg-indigo-500';
    return 'bg-slate-800';
  };

  return (
    <div className="min-h-screen p-2 md:p-8 max-w-7xl mx-auto space-y-4 md:space-y-6 bg-[#020617] text-[#f8fafc] overflow-x-hidden relative selection:bg-sky-500/30">
      <div className="fixed top-4 md:top-24 right-4 md:right-8 z-[2000] flex flex-col gap-3 max-w-[calc(100%-2rem)] md:max-w-sm w-full pointer-events-none">
        {alerts.map(alert => (
          <div key={alert.id} className={`p-4 md:p-5 rounded-2xl border backdrop-blur-3xl shadow-2xl transition-all duration-500 pointer-events-auto ${alert.type === 'GOLDEN' ? 'bg-amber-500/10 border-amber-500/50 text-amber-500' : alert.type === 'SIGNAL' ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' : 'bg-slate-900 border-slate-700 text-slate-300'}`}>
            <div className="flex justify-between items-start mb-1">
              <span className="text-[8px] md:text-[10px] font-black uppercase tracking-[0.2em]">{alert.type} TRIGGER</span>
              <span className="text-[7px] md:text-[8px] font-mono opacity-50">{alert.timestamp}</span>
            </div>
            <p className="text-xs md:text-sm font-bold leading-tight tracking-tight">{alert.message}</p>
          </div>
        ))}
      </div>

      <nav className="flex flex-col lg:flex-row justify-between items-center gap-4 md:gap-6 px-4 md:px-8 py-4 md:py-5 bg-slate-900/40 backdrop-blur-3xl rounded-2xl md:rounded-[2.5rem] border border-slate-800/60 shadow-2xl relative z-50">
        <div className="flex flex-col sm:flex-row items-center gap-4 md:gap-8 w-full lg:w-auto">
          <div className="space-y-1 text-center sm:text-left">
            <h1 className="text-xl md:text-2xl font-black tracking-tighter neon-text-blue leading-none italic">AETHER ORACLE</h1>
            <div className="flex flex-wrap justify-center sm:justify-start items-center gap-2 md:gap-3">
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${getStatusColor(streamingStatus)} ${fetchingData ? 'animate-pulse' : ''}`} />
                <span className="text-[8px] md:text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">{streamingStatus.replace('_', ' ')}</span>
              </div>
              <div className="h-3 w-px bg-slate-800 hidden sm:block" />
              <div className="flex items-center gap-1.5">
                 <span className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${marketLive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-700'}`} />
                 <span className="text-[8px] md:text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">{marketLive ? 'LIVE' : 'CLOSED'}</span>
              </div>
            </div>
          </div>
          <div className="flex bg-slate-950/90 p-1 md:p-1.5 rounded-xl md:rounded-2xl border border-slate-800 shadow-inner w-full sm:w-auto">
            {SYMBOLS.map(s => (
              <button key={s} disabled={fetchingData && s !== selectedSymbol} onClick={() => handleSymbolChange(s)} className={`flex-1 sm:flex-none px-4 md:px-8 py-2 md:py-2.5 rounded-lg md:rounded-xl text-[10px] md:text-[11px] font-black transition-all duration-300 ${selectedSymbol === s ? 'bg-sky-500 text-white shadow-lg scale-105' : 'text-slate-500 hover:text-slate-300'}`}>{s}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between lg:justify-end gap-6 w-full lg:w-auto">
          <div className="text-left lg:text-right border-r border-slate-800/60 pr-8">
            <span className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-0.5">Prop Balance</span>
            <div className="text-xs md:text-sm font-mono font-bold text-emerald-400 tabular-nums">${propStats.currentEquity.toLocaleString()}</div>
          </div>
          <button onClick={() => setShowVault(true)} className={`p-3 md:p-4 rounded-xl md:rounded-2xl border transition-all ${isTradierConnected ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' : 'bg-slate-800/40 border-slate-700 text-sky-400'}`}>
            <ICONS.Shield size={18} />
          </button>
        </div>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-8 relative z-10">
        <div className="order-1 lg:order-2 lg:col-span-6 space-y-4 md:order-1 md:space-y-8">
          <div className={`glass-effect rounded-2xl md:rounded-[2.5rem] p-4 md:p-10 transition-all duration-700 ${isGoldenFlow ? 'border-amber-500/50 shadow-2xl' : 'border-sky-500/10 shadow-xl'} min-h-[400px] md:min-h-[550px] relative overflow-hidden`}>
            {fetchingData && !marketData ? (
               <div className="h-[300px] md:h-[400px] flex flex-col items-center justify-center gap-6"><div className="w-12 h-12 md:w-16 md:h-16 border-4 border-sky-500/10 border-t-sky-500 rounded-full animate-spin" /><p className="text-[8px] md:text-[10px] font-black uppercase tracking-[0.4em] text-sky-500 animate-pulse">Syncing Tape...</p></div>
            ) : marketData ? (
              <div className="space-y-6 md:space-y-8 animate-in fade-in duration-1000">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
                  <div className="space-y-1 md:space-y-2 w-full">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 md:px-4 py-1 bg-slate-800 text-white rounded-full text-[8px] md:text-[10px] font-black uppercase tracking-[0.2em]">{selectedSymbol}</span>
                      <span className={`text-[8px] md:text-[10px] font-black uppercase px-2 py-0.5 rounded ${marketData.levels?.bias === 'BULLISH' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>{marketData.levels?.bias}</span>
                      {isGoldenFlow && (
                        <span className="px-2 py-0.5 bg-amber-500/20 text-amber-500 border border-amber-500/30 rounded text-[8px] md:text-[10px] font-black uppercase tracking-widest animate-pulse">GOLDEN</span>
                      )}
                    </div>
                    <div className={`text-4xl sm:text-6xl md:text-8xl font-black mono tracking-tighter leading-none transition-colors duration-500 ${isGoldenFlow ? 'text-amber-400' : 'text-sky-400'}`}>${Number(marketData.currentPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div className="text-right space-y-1 w-full sm:w-auto">
                    <span className="text-[8px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest">VIX</span>
                    <div className="text-3xl md:text-5xl font-black mono text-sky-400">{Number(marketData.vix).toFixed(2)}</div>
                  </div>
                </div>
                <div className="relative h-64 md:h-96">
                  <MarketChart 
                    data={marketData.history} 
                    symbol={selectedSymbol} 
                    signals={signalHistory} 
                    levels={marketData.levels} 
                    flowHistory={windowHistory} 
                  />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 md:gap-6 pt-4 md:pt-8 border-t border-slate-800/50">
                  {[
                    {k: 'WEEKLY HP', v: marketData.levels?.hp}, 
                    {k: 'MONTHLY HP', v: marketData.levels?.mhp}, 
                    {k: 'GAMMA FLIP', v: marketData.levels?.gammaFlip}, 
                    {k: 'VANNA PIVOT', v: marketData.levels?.vannaPivot}
                  ].map(item => (
                    <div key={item.k} className="space-y-1 md:space-y-1.5">
                      <span className="text-[7px] md:text-[9px] font-black text-slate-500 uppercase tracking-widest block">{item.k}</span>
                      <div className="text-[11px] md:text-sm font-mono font-bold text-white tracking-tight">${Number(item.v || 0).toFixed(2)}</div>
                    </div>
                  ))}
                  <div className={`col-span-2 sm:col-span-1 space-y-1 md:space-y-1.5 p-2 rounded-xl border ${isGoldenFlow ? 'bg-amber-500/10 border-amber-500/40' : 'bg-slate-900/40 border-slate-800/40'}`}>
                    <span className={`text-[7px] md:text-[9px] font-black uppercase tracking-widest block ${isGoldenFlow ? 'text-amber-500' : 'text-slate-500'}`}>INTENSITY</span>
                    <div className={`text-[11px] md:text-sm font-mono font-black tracking-tight ${isGoldenFlow ? 'text-amber-400' : 'text-sky-400'}`}>{Number(currentLixi).toFixed(2)}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-64 flex flex-col items-center justify-center gap-8 opacity-20"><ICONS.Activity size={60} /></div>
            )}
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-8">
            <div className="glass-effect p-4 md:p-8 rounded-2xl md:rounded-[2rem] border border-slate-800/40">
              <h3 className="text-[8px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 md:mb-6">Ensemble Insights</h3>
              {analysis?.signal.ensembleInsights ? (
                <div className="space-y-3 md:space-y-5">
                  {analysis.signal.ensembleInsights.map(insight => (
                    <div key={insight.category} className="space-y-1 md:space-y-2">
                      <div className="flex justify-between text-[8px] md:text-[10px] font-black uppercase">
                        <span className="text-slate-400">{insight.category}</span>
                        <span className={insight.sentiment === 'BULLISH' ? 'text-emerald-400' : 'text-rose-400'}>{insight.sentiment}</span>
                      </div>
                      <div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden">
                        <div className={`h-full transition-all duration-1000 ${insight.sentiment === 'BULLISH' ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${insight.weight}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div className="h-20 flex items-center justify-center opacity-5"><ICONS.Activity size={24} /></div>}
            </div>

            <div className="glass-effect p-4 md:p-8 rounded-2xl md:rounded-[2rem] border border-slate-800/40">
              <h3 className="text-[8px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 md:mb-6">Sentiment Pulse</h3>
              {sentiment ? (
                <div className="space-y-4">
                  <div className="text-center">
                    <div className={`text-2xl md:text-4xl font-black mono tracking-tighter ${sentiment.score > 20 ? 'text-emerald-400' : sentiment.score < -20 ? 'text-rose-400' : 'text-sky-400'}`}>
                      {sentiment.score > 0 ? '+' : ''}{sentiment.score}
                    </div>
                    <div className="text-[7px] md:text-[8px] font-black text-slate-500 uppercase tracking-widest">{sentiment.label}</div>
                  </div>
                  <div className="space-y-1.5 mt-2">
                    {sentiment.headlines.map((h, i) => (
                      <div key={i} className="flex gap-2 items-start">
                        <div className={`w-1 h-2 rounded-full mt-1 shrink-0 ${h.sentiment === 'BULLISH' ? 'bg-emerald-500' : h.sentiment === 'BEARISH' ? 'bg-rose-500' : 'bg-slate-700'}`} />
                        <p className="text-[8px] md:text-[9px] text-slate-300 font-bold leading-tight line-clamp-1">{h.title}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <div className="h-20 flex items-center justify-center opacity-5"><ICONS.Activity size={24} /></div>}
            </div>

            <div className="glass-effect p-4 md:p-8 rounded-2xl md:rounded-[2rem] border border-slate-800/40 flex flex-col justify-center text-center">
              <span className="text-[8px] md:text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 block">Neural Posture</span>
              <div className={`text-3xl md:text-5xl font-black italic tracking-tighter ${analysis?.signal.executionStatus === 'RISK ON' ? 'text-emerald-400' : 'text-slate-600'}`}>{analysis?.signal.executionStatus || 'STANDBY'}</div>
            </div>
          </div>
        </div>

        <div className="order-2 lg:order-3 lg:col-span-3 h-full">
          <div className={`glass-effect rounded-2xl md:rounded-[2.5rem] p-6 md:p-9 border-l-4 md:border-l-[6px] transition-all duration-1000 h-full flex flex-col shadow-xl relative ${oracleReady ? (analysis?.signal.type === 'BUY' ? 'border-emerald-500' : analysis?.signal.type === 'SELL' ? 'border-rose-500' : 'border-sky-500') : 'border-slate-800'}`}>
            <div className="flex justify-between items-start mb-8 md:mb-12">
              <div className="space-y-1">
                <h2 className="text-xl md:text-3xl font-black uppercase tracking-tighter">Neural Vote</h2>
                <span className="text-[8px] md:text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">consus engine</span>
              </div>
              <button onClick={runAnalysis} disabled={loading || !oracleReady || fetchingData} className={`p-4 md:p-6 rounded-xl md:rounded-2xl transition-all duration-300 active:scale-90 ${oracleReady && !fetchingData ? 'bg-sky-500 text-white shadow-xl hover:rotate-2' : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}>
                <ICONS.Zap size={24} className={loading ? 'animate-pulse' : ''} />
              </button>
            </div>
            {analysis ? (
              <div className="space-y-8 flex-1 animate-in slide-in-from-bottom-4 duration-700">
                <div className="text-center space-y-1">
                  <span className={`text-7xl md:text-9xl font-black mono tracking-tighter leading-none ${analysis.signal.voteCount >= 85 ? 'text-emerald-400' : 'text-sky-400'}`}>{Number(analysis.signal.voteCount || 0)}</span>
                  <div className="text-[9px] md:text-[11px] font-black uppercase text-slate-500 tracking-[0.3em]">Consensus</div>
                </div>
                <div className="bg-slate-950/60 p-5 md:p-7 rounded-2xl md:rounded-[2rem] border border-slate-800 space-y-4 shadow-inner">
                   {[
                     {l: 'ENTRY', v: analysis.signal.entry}, 
                     {l: 'STOP', v: analysis.signal.stopLoss}, 
                     {l: 'TAKE', v: analysis.signal.takeProfit}
                   ].map(item => (
                     <div key={item.l} className="flex justify-between items-center border-b border-slate-900 pb-3 last:border-0 last:pb-0">
                       <span className="text-[8px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest">{item.l}</span>
                       <span className="text-sm md:text-base font-mono font-black text-white tracking-tight">${Number(item.v || 0).toFixed(2)}</span>
                     </div>
                   ))}
                </div>
                <div className="p-5 md:p-7 bg-slate-900/30 rounded-2xl md:rounded-[2rem] border border-dashed border-slate-800">
                  <p className="text-[10px] md:text-[12px] text-slate-400 font-mono italic leading-relaxed">"{analysis.signal.reasoning}"</p>
                </div>
              </div>
            ) : <div className="flex-1 flex flex-col items-center justify-center opacity-5 gap-4 pt-10"><ICONS.Activity size={80} /></div>}
          </div>
        </div>

        <div className="order-3 lg:order-1 lg:col-span-3">
          <div className="glass-effect rounded-2xl md:rounded-[2.5rem] p-4 md:p-7 border border-slate-800/40 h-[400px] md:h-[700px] flex flex-col shadow-xl relative overflow-hidden">
            <div className="flex justify-between items-center mb-6">
              <div className="space-y-0.5">
                <h3 className="text-[9px] md:text-[11px] font-black text-slate-400 uppercase tracking-widest">Aether Flow</h3>
                <p className="text-[7px] md:text-[8px] text-slate-600 font-mono uppercase tracking-widest">Institutional Pipeline</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-black text-slate-600 uppercase tabular-nums">{countdown}s</span>
                <button onClick={() => fetchData()} disabled={fetchingData} className="p-1.5 md:p-2 bg-sky-500/10 hover:bg-sky-500/20 rounded-lg text-sky-400 transition-all active:scale-90"><ICONS.Activity size={12} /></button>
              </div>
            </div>
            
            <div className="flex-1 flex gap-2 md:gap-4 overflow-hidden">
              <div className="w-1 md:w-1.5 h-full rounded-full bg-slate-900/50 flex flex-col gap-0.5 md:gap-1 overflow-hidden">
                {windowHistory.map((win, idx) => (
                  <div key={`spec-${idx}`} className={`flex-1 w-full rounded-sm transition-all duration-1000 ${getLixiIntensity(win.lixi)}`} />
                ))}
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-3 md:space-y-4 pr-1 scrollbar-hide">
                {windowHistory.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center opacity-10 gap-4"><ICONS.Activity size={32} className="animate-pulse" /></div>
                ) : windowHistory.map(win => (
                  <div key={win.id} className={`p-3 md:p-5 rounded-xl md:rounded-2xl border transition-all duration-700 ${win.lixi > 7.5 ? 'border-amber-500/60 bg-amber-500/[0.05]' : 'border-slate-800/40 bg-slate-950/30'}`}>
                    <div className="flex justify-between text-[7px] md:text-[8px] font-mono mb-2 md:mb-3">
                      <span className="text-slate-500">{win.timestamp}</span>
                      <span className={win.lixi > 7.5 ? 'text-amber-500 font-black tracking-widest' : 'text-slate-600'}>{win.lixi > 7.5 ? 'GOLDEN' : 'NEUTRAL'}</span>
                    </div>
                    <div className="flex justify-between items-end">
                      <div className={`text-xs md:text-sm font-black italic tracking-tighter ${win.label === TickLabel.UPWARDS ? 'text-emerald-400' : win.label === TickLabel.DOWNWARDS ? 'text-rose-400' : 'text-slate-500'}`}>{win.label}</div>
                      <div className="text-right">
                        <span className={`text-xl md:text-2xl font-black mono block leading-none ${win.lixi > 7.5 ? 'text-amber-400' : 'text-sky-400'}`}>{win.lixi.toFixed(2)}</span>
                        <span className="text-[6px] md:text-[7px] font-bold text-slate-500 uppercase tracking-widest mt-0.5 block">LIXI DEPTH</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showVault && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 md:p-6 bg-slate-950/98 backdrop-blur-3xl" onClick={() => setShowVault(false)}>
          <div className="glass-effect rounded-2xl md:rounded-[3rem] p-8 md:p-12 border border-slate-700/40 max-w-md w-full relative z-10 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-8 md:mb-10 text-center">
              <h3 className="text-2xl md:text-4xl font-black text-white tracking-tighter uppercase mb-2">Quant Bridge</h3>
              <p className="text-[8px] md:text-[10px] text-slate-500 uppercase font-black tracking-[0.2em]">feed configuration</p>
            </div>
            <div className="space-y-6 md:space-y-8">
              <div className="space-y-2">
                <label className="text-[8px] md:text-[10px] font-black uppercase text-slate-400 ml-1">Access Token</label>
                <input type="password" value={inputToken} onChange={(e) => setInputToken(e.target.value)} className="w-full bg-slate-900/80 border border-slate-800 rounded-xl md:rounded-2xl px-4 md:px-6 py-4 md:py-5 text-sm text-sky-400 outline-none font-mono" placeholder="Bearer..." />
              </div>
              <button onClick={() => setIsSandbox(!isSandbox)} className="w-full flex justify-between items-center p-4 md:p-6 bg-slate-900 rounded-xl md:rounded-2xl border border-slate-800">
                <div className="text-left">
                  <span className="text-[9px] md:text-[11px] font-black uppercase text-slate-200 block">Sandbox Pipeline</span>
                </div>
                <div className={`w-10 md:w-14 h-5 md:h-7 rounded-full p-1 transition-all duration-500 ${isSandbox ? 'bg-sky-500' : 'bg-slate-700'}`}><div className={`w-3 md:w-4 h-3 md:h-4 bg-white rounded-full transition-all duration-500 ${isSandbox ? 'translate-x-5 md:translate-x-7' : ''}`} /></div>
              </button>
              <button onClick={handleSaveToken} className="w-full bg-sky-500 hover:bg-sky-400 text-white font-black py-4 md:py-6 rounded-xl md:rounded-2xl uppercase tracking-[0.2em] text-[10px] md:text-[12px] transition-all active:scale-95">Establish Bridge</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
