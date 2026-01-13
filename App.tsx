
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MarketData, AnalysisResponse, HistoricalSignal, PricePoint } from './types';
import { SYMBOLS, ICONS } from './constants';
import { analyzeMarket, fetchMarketDataViaSearch } from './services/geminiService';
import { TradierService } from './services/tradierService';
import MarketChart from './components/MarketChart';

const formatToEST = (date: Date) => {
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};

const App: React.FC = () => {
  const [selectedSymbol, setSelectedSymbol] = useState(SYMBOLS[0]);
  const [isTradierConnected, setIsTradierConnected] = useState(false);
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingData, setFetchingData] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [dataSources, setDataSources] = useState<any[]>([]);
  const [dataSourceType, setDataSourceType] = useState<'TRADIER' | 'GEMINI_SEARCH' | 'NONE'>('NONE');
  const [showVault, setShowVault] = useState(false);
  const [inputToken, setInputToken] = useState('');
  const [isSandbox, setIsSandbox] = useState(false);
  const [signalHistory, setSignalHistory] = useState<HistoricalSignal[]>([]);
  const [errorNotification, setErrorNotification] = useState<{ message: string; type: 'ERROR' | 'WARN' } | null>(null);
  
  const tradierRef = useRef<TradierService | null>(null);

  // Auto-clear notification after delay
  useEffect(() => {
    if (errorNotification) {
      const timer = setTimeout(() => setErrorNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [errorNotification]);

  // Persistence logic
  useEffect(() => {
    const savedHistory = localStorage.getItem('SIGNAL_HISTORY');
    if (savedHistory) {
      try {
        setSignalHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('SIGNAL_HISTORY', JSON.stringify(signalHistory));
  }, [signalHistory]);

  const initConnection = useCallback(() => {
    const savedToken = localStorage.getItem('TRADIER_TOKEN');
    const savedSandbox = localStorage.getItem('TRADIER_SANDBOX') === 'true';
    const token = savedToken || (process.env as any).TRADIER_TOKEN;
    const sandbox = savedToken ? savedSandbox : false;

    if (token && token !== '') {
      tradierRef.current = new TradierService(token, sandbox);
      setIsTradierConnected(true);
      setDataSourceType('TRADIER');
      setIsSandbox(sandbox);
      if (!inputToken) setInputToken(token);
    } else {
      setIsTradierConnected(false);
      setDataSourceType('GEMINI_SEARCH');
    }
  }, [inputToken]);

  useEffect(() => {
    initConnection();
  }, [initConnection]);

  const fetchData = useCallback(async () => {
    setFetchingData(true);
    try {
      if (isTradierConnected && tradierRef.current) {
        const quotes = await tradierRef.current.getQuotes(SYMBOLS.concat(['VIX']));
        const history = await tradierRef.current.getIntradayHistory(selectedSymbol);
        
        const currentQuote = quotes.find(q => q.symbol === selectedSymbol);
        const vixQuote = quotes.find(q => q.symbol === 'VIX');
        
        if (currentQuote) {
          const searchMeta = await fetchMarketDataViaSearch(selectedSymbol);

          const processedHistory: PricePoint[] = history.map((h, idx) => {
            const timeStr = formatToEST(new Date(h.date));
            const flowMatch = searchMeta.history?.find(sh => sh.time.split(',')[1] === timeStr.split(',')[1]);
            
            return {
              time: timeStr,
              price: h.close,
              volume: h.volume,
              gamma: flowMatch?.gamma,
              vanna: flowMatch?.vanna
            };
          });

          if (processedHistory.length > 0 && !processedHistory.some(p => p.gamma !== undefined)) {
            const lastIdx = processedHistory.length - 1;
            processedHistory[lastIdx].gamma = searchMeta.gamma;
            processedHistory[lastIdx].vanna = searchMeta.vanna;
          }

          setMarketData({
            symbol: selectedSymbol,
            currentPrice: currentQuote.last,
            change24h: currentQuote.change_percentage,
            volume24h: currentQuote.volume,
            vix: vixQuote?.last || 15.0,
            gamma: searchMeta.gamma,
            vanna: searchMeta.vanna,
            history: processedHistory
          });
        }
      } else {
        const data = await fetchMarketDataViaSearch(selectedSymbol);
        setMarketData({
          symbol: selectedSymbol,
          currentPrice: data.currentPrice || 0,
          change24h: data.change24h || 0,
          volume24h: 0,
          vix: data.vix || 15,
          gamma: data.gamma,
          vanna: data.vanna,
          history: (data.history || []).map(h => ({
            ...h,
            time: h.time.includes(',') ? h.time : formatToEST(new Date()) 
          }))
        });
        setDataSources(data.sources || []);
      }
    } catch (err: any) {
      console.error("Data Feed Error:", err);
      const msg = err.message || 'Unknown protocol error';
      setErrorNotification({ message: `Feed Interrupted: ${msg}`, type: 'ERROR' });

      if (msg.toLowerCase().includes('auth') || msg.toLowerCase().includes('401') || msg.toLowerCase().includes('forbidden')) {
        setIsTradierConnected(false);
        setDataSourceType('GEMINI_SEARCH');
      }
    } finally {
      setFetchingData(false);
    }
  }, [selectedSymbol, isTradierConnected]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const runAnalysis = useCallback(async () => {
    if (!marketData || marketData.history.length === 0) return;
    setLoading(true);
    try {
      const result = await analyzeMarket(marketData);
      setAnalysis(result);
      setLastUpdate(new Date());

      const lastBar = marketData.history[marketData.history.length - 1];

      const newEntry: HistoricalSignal = {
        ...result.signal,
        id: crypto.randomUUID(),
        symbol: marketData.symbol,
        timestamp: new Date().toISOString(),
        chartTime: lastBar.time,
        priceAtSignal: marketData.currentPrice
      };
      setSignalHistory(prev => [newEntry, ...prev].slice(0, 50));
    } catch (err: any) {
      console.error("Oracle Failed:", err);
      setErrorNotification({ message: `Oracle Logical Error: ${err.message || 'Failed to parse market state'}`, type: 'ERROR' });
    } finally {
      setLoading(false);
    }
  }, [marketData]);

  const handleSaveToken = () => {
    if (inputToken.trim()) {
      localStorage.setItem('TRADIER_TOKEN', inputToken.trim());
      localStorage.setItem('TRADIER_SANDBOX', isSandbox.toString());
      initConnection();
      setShowVault(false);
    }
  };

  const handleClearToken = () => {
    localStorage.removeItem('TRADIER_TOKEN');
    localStorage.removeItem('TRADIER_SANDBOX');
    setInputToken('');
    setIsSandbox(false);
    tradierRef.current = null;
    setIsTradierConnected(false);
    setDataSourceType('GEMINI_SEARCH');
    setShowVault(false);
  };

  const clearHistory = () => {
    if (window.confirm("Purge all historical signal records?")) {
      setSignalHistory([]);
    }
  };

  const getSignalBadge = (type: string) => {
    switch (type) {
      case 'BUY': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'SELL': return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      default: return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto space-y-6 relative overflow-hidden">
      {/* Background Decor */}
      <div className="fixed top-[-10%] right-[-10%] w-[500px] h-[500px] bg-sky-500/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-emerald-500/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Global Error Notification */}
      {errorNotification && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[150] flex items-center gap-3 px-6 py-4 bg-slate-900 border border-rose-500/50 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] animate-in slide-in-from-bottom duration-300">
           <div className={`w-2 h-2 rounded-full animate-pulse ${errorNotification.type === 'ERROR' ? 'bg-rose-500' : 'bg-amber-500'}`} />
           <span className="text-xs font-mono font-bold text-white tracking-tight uppercase">
             {errorNotification.message}
           </span>
           <button onClick={() => setErrorNotification(null)} className="ml-4 text-slate-500 hover:text-white">
             <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
           </button>
        </div>
      )}

      {showVault && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/95 backdrop-blur-2xl p-6">
          <div className="max-w-md w-full glass-effect rounded-3xl p-8 border-sky-500/30 shadow-2xl space-y-8 animate-in zoom-in duration-300">
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-white tracking-tighter uppercase flex items-center gap-3">
                <ICONS.Shield className="text-sky-400" />
                Auth Protocol
              </h2>
              <p className="text-slate-400 text-xs font-mono uppercase tracking-widest">Connect Tradier REST Feed</p>
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] text-slate-500 font-black uppercase tracking-widest ml-1">REST API Token</label>
                <input 
                  type="password"
                  value={inputToken}
                  onChange={(e) => setInputToken(e.target.value)}
                  placeholder="Paste Token..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-sky-400 font-mono text-sm focus:outline-none focus:border-sky-500/50 transition-colors"
                />
              </div>

              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative">
                  <input 
                    type="checkbox" 
                    checked={isSandbox} 
                    onChange={(e) => setIsSandbox(e.target.checked)}
                    className="sr-only"
                  />
                  <div className={`w-10 h-5 rounded-full transition-colors ${isSandbox ? 'bg-sky-500' : 'bg-slate-800'}`} />
                  <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${isSandbox ? 'translate-x-5' : ''}`} />
                </div>
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest group-hover:text-slate-300 transition-colors font-mono">
                  Sandbox Context
                </span>
              </label>
            </div>

            <div className="flex flex-col gap-3 pt-4">
              <button 
                onClick={handleSaveToken}
                className="w-full py-4 bg-sky-500 text-white font-black uppercase tracking-[0.3em] text-[11px] rounded-2xl shadow-[0_10px_30px_rgba(14,165,233,0.3)] hover:bg-sky-400 transition-colors"
              >
                Establish Link
              </button>
              <button 
                onClick={handleClearToken}
                className="w-full py-3 text-rose-500/70 hover:text-rose-400 text-[9px] font-black uppercase tracking-widest transition-colors mb-2"
              >
                Disconnect Link
              </button>
              <button 
                onClick={() => setShowVault(false)}
                className="w-full py-3 text-slate-500 hover:text-white text-[9px] font-black uppercase tracking-widest transition-colors"
              >
                Return to Terminal
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-900 pb-6 relative z-10">
        <div className="space-y-1">
          <h1 className="text-4xl font-black tracking-tighter neon-text-blue flex items-center gap-3">
            <ICONS.Activity className="text-sky-400 w-8 h-8" />
            AETHER <span className="font-light text-slate-500">QUANT</span>
          </h1>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-[9px] uppercase tracking-[0.3em] font-mono">Feed:</span>
              <span className={`flex items-center gap-1.5 text-[9px] font-mono font-bold ${dataSourceType === 'TRADIER' ? 'text-emerald-400' : 'text-sky-400'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${fetchingData ? 'animate-ping' : ''} ${dataSourceType === 'TRADIER' ? 'bg-emerald-500' : 'bg-sky-500'}`} />
                {dataSourceType === 'TRADIER' ? `TRADIER_SEARCH_HYBRID` : 'GEMINI_FALLBACK'}
              </span>
            </div>
            <button 
              onClick={() => setShowVault(true)}
              className="group flex items-center gap-2 text-[9px] text-slate-500 hover:text-sky-400 transition-colors uppercase tracking-[0.2em] font-black border-b border-slate-800 pb-0.5"
            >
              <ICONS.Zap className="w-3 h-3 group-hover:rotate-12 transition-transform" />
              [VAULT]
            </button>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex bg-slate-950/80 backdrop-blur p-1.5 rounded-xl border border-slate-800 shadow-2xl">
            {SYMBOLS.map(symbol => (
              <button
                key={symbol}
                onClick={() => setSelectedSymbol(symbol)}
                className={`px-8 py-2.5 rounded-lg transition-all text-xs font-bold tracking-widest uppercase ${
                  selectedSymbol === symbol 
                  ? 'bg-sky-500 text-white shadow-[0_0_20px_rgba(14,165,233,0.3)] scale-105' 
                  : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {symbol}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 relative z-10">
        <div className="lg:col-span-2 space-y-8">
          <div className="glass-effect rounded-3xl p-8 neon-border-blue relative overflow-hidden min-h-[500px] border-t border-sky-500/20">
            <div className="flex justify-between items-end mb-10 relative z-10">
              <div className="space-y-1">
                <div className="text-slate-500 text-[10px] font-mono uppercase tracking-[0.4em]">
                  Intraday Multi-Day Matrix (3-Day Sequence EST)
                </div>
                <div className="text-6xl font-bold mono tracking-tighter text-white">
                  {marketData ? `$${marketData.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '---'}
                </div>
                <div className={`text-sm font-bold flex items-center gap-1.5 ${marketData && marketData.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {marketData && marketData.change24h >= 0 ? <ICONS.TrendingUp size={18} /> : <ICONS.TrendingDown size={18} />}
                  {marketData ? `${marketData.change24h.toFixed(2)}%` : '0.00%'}
                  <span className="text-slate-600 font-normal text-[10px] ml-1 uppercase tracking-widest font-mono">Momentum</span>
                </div>
              </div>
              <div className="text-right space-y-1">
                <div className="text-slate-500 text-[10px] font-mono uppercase tracking-[0.4em]">Fear Gauge (VIX)</div>
                <div className="text-3xl font-bold mono text-sky-400">
                  {marketData?.vix.toFixed(2) || '--.--'}
                </div>
              </div>
            </div>

            {marketData && marketData.history.length > 0 ? (
               <MarketChart 
                 data={marketData.history} 
                 symbol={selectedSymbol} 
                 signals={signalHistory} 
               />
            ) : (
              <div className="h-64 flex flex-col items-center justify-center text-slate-700 italic font-mono space-y-6">
                <div className="relative">
                   <div className="w-16 h-16 border-2 border-sky-500/10 border-t-sky-500 rounded-full animate-spin" />
                   <ICONS.Zap className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-sky-500/40 animate-pulse" size={24} />
                </div>
                <div className="text-center space-y-2">
                  <p className="text-xs uppercase tracking-[0.4em] font-black text-slate-500">Syncing 3-Day Window</p>
                  <p className="text-[9px] text-slate-600 max-w-[250px] mx-auto leading-relaxed uppercase tracking-widest">
                    Compiling 1-minute sequences for {selectedSymbol}...
                  </p>
                </div>
              </div>
            )}
            
            <div className="mt-8 flex items-center gap-6 border-t border-slate-900 pt-6">
               <div className="flex flex-col">
                  <span className="text-[8px] text-slate-600 font-black uppercase tracking-widest">Timezone</span>
                  <span className="text-[10px] text-sky-500 font-mono font-bold">EST (New York)</span>
               </div>
               <div className="flex flex-col">
                  <span className="text-[8px] text-slate-600 font-black uppercase tracking-widest">Horizon</span>
                  <span className="text-[10px] text-emerald-500 font-mono font-bold">3 Trading Days</span>
               </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
             <div className="glass-effect p-6 rounded-2xl border border-slate-800/50 hover:border-sky-500/20 transition-all group">
                <h3 className="text-slate-400 text-[10px] font-bold uppercase tracking-[0.3em] flex items-center gap-2 mb-6 group-hover:text-sky-400 transition-colors">
                  <ICONS.Zap size={16} className="text-amber-400" />
                  Contextual reasoning
                </h3>
                <div className="space-y-4">
                  {analysis?.macroFactors.map((factor, idx) => (
                    <div key={idx} className="flex items-start gap-3 text-sm text-slate-300 bg-slate-900/40 p-4 rounded-xl border border-slate-800/30">
                      <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.5)] shrink-0" />
                      <span className="leading-tight text-xs font-medium">{factor}</span>
                    </div>
                  ))}
                  {!analysis && (
                    <div className="py-12 text-center border-2 border-dashed border-slate-900/50 rounded-2xl">
                      <p className="text-[10px] text-slate-700 uppercase tracking-[0.3em] font-black">Scan Inactive</p>
                    </div>
                  )}
                </div>
             </div>
             
             <div className="glass-effect p-6 rounded-2xl border border-slate-800/50">
                <h3 className="text-slate-400 text-[10px] font-bold uppercase tracking-[0.3em] flex items-center gap-2 mb-6">
                  <ICONS.Shield size={16} className="text-emerald-400" />
                  Risk Protocol
                </h3>
                <div className="space-y-6">
                  <div className="flex justify-between items-center bg-slate-950/50 p-3 rounded-xl border border-slate-900">
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold font-mono">Link State</span>
                    <span className="font-mono font-bold text-[10px] text-emerald-400 uppercase">
                      FLOW_HYBRID
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800 space-y-1">
                      <span className="text-[8px] text-slate-600 font-black uppercase tracking-widest">Gamma (GEX)</span>
                      <span className="text-xs font-mono font-bold text-sky-400">{marketData?.gamma !== undefined ? `${marketData.gamma}bn` : '--'}</span>
                    </div>
                    <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800 space-y-1">
                      <span className="text-[8px] text-slate-600 font-black uppercase tracking-widest">Vanna Level</span>
                      <span className="text-xs font-mono font-bold text-sky-400">{marketData?.vanna !== undefined ? marketData.vanna : '--'}</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-slate-500 uppercase tracking-widest font-bold">Liquidity Score</span>
                      <span className="text-sky-400 font-mono font-bold">{analysis?.liquidityScore || 0}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden border border-slate-900">
                      <div 
                        className="h-full bg-gradient-to-r from-sky-600 to-sky-400 transition-all duration-1000" 
                        style={{ width: `${analysis?.liquidityScore || 0}%` }}
                      />
                    </div>
                  </div>
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-[10px] text-slate-400 leading-relaxed font-mono relative">
                    <span className="text-emerald-500 text-[9px] font-black uppercase tracking-widest block mb-1">DATA_LOG:</span>
                    {marketData?.gamma !== undefined 
                      ? "Structural flow metrics active. Cross-referencing price with GEX magnets."
                      : "Establishing structural flow sequence. Use search grounding to pull Gamma/Vanna."}
                  </div>
                </div>
             </div>
          </div>
        </div>

        <div className="space-y-8 relative z-10">
          <div className="glass-effect rounded-3xl p-8 border-l-[6px] border-l-sky-500 flex flex-col h-full min-h-[500px] shadow-2xl relative overflow-hidden border-t border-sky-500/10">
            <div className="flex justify-between items-center mb-10">
              <div className="space-y-1">
                <h2 className="text-2xl font-black text-white tracking-tighter uppercase">Oracle Output</h2>
                <div className="flex items-center gap-2">
                  <span className="text-[8px] bg-sky-500/20 text-sky-400 px-2 py-0.5 rounded font-black tracking-widest uppercase">Gamma_Vanna_Aware</span>
                </div>
              </div>
              <button 
                onClick={runAnalysis}
                disabled={loading || !marketData}
                className="p-3 bg-sky-500/10 hover:bg-sky-500/20 rounded-2xl transition-all disabled:opacity-30 group"
              >
                <ICONS.Activity className={`text-sky-400 group-hover:scale-110 transition-transform ${loading ? 'animate-spin' : ''}`} size={24} />
              </button>
            </div>

            {loading ? (
              <div className="flex-1 flex flex-col items-center justify-center space-y-8 py-12 text-center">
                <div className="relative w-24 h-24">
                  <div className="absolute inset-0 border-4 border-sky-500/5 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
                <div className="space-y-3">
                  <p className="text-white text-xs font-black uppercase tracking-[0.5em]">Deconstructing Flows</p>
                  <p className="text-slate-600 text-[10px] font-mono animate-pulse uppercase tracking-widest">
                    Synthesizing Dealer Positioning...
                  </p>
                </div>
              </div>
            ) : analysis ? (
              <div className="flex-1 space-y-8 animate-in fade-in duration-700">
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-mono border-2 px-3 py-1.5 rounded-lg font-black tracking-[0.2em] uppercase ${getSignalBadge(analysis.signal.type)}`}>
                    {analysis.signal.type}
                  </span>
                  <div className="text-right">
                     <span className="block text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Confidence</span>
                     <span className="text-sm text-sky-400 font-mono font-bold tracking-tighter">{(analysis.signal.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="space-y-2">
                    <span className="text-[10px] text-slate-500 uppercase tracking-[0.4em] font-bold flex items-center gap-2">
                      Structural Zone
                    </span>
                    <div className="bg-sky-500/5 border border-sky-500/20 p-4 rounded-2xl">
                       <span className="text-lg font-black neon-text-blue uppercase tracking-tight block">
                         {analysis.signal.liquidityZone || "Stable Flow Zone"}
                       </span>
                    </div>
                  </div>

                  <div className="bg-slate-950/80 p-6 rounded-2xl border border-slate-800 space-y-5 shadow-inner">
                    <div className="flex justify-between items-center border-b border-slate-800/50 pb-4">
                      <span className="text-[10px] text-slate-500 uppercase tracking-[0.2em] font-black font-mono">Entry</span>
                      <span className="text-3xl font-bold mono text-sky-400 tracking-tighter">${analysis.signal.entry.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-rose-500/5 p-4 rounded-xl border border-rose-500/10 space-y-1">
                        <span className="block text-[9px] text-rose-400/60 uppercase font-black tracking-widest font-mono">Stop</span>
                        <span className="text-base font-bold text-rose-400 mono tracking-tighter">${analysis.signal.stopLoss.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="bg-emerald-500/5 p-4 rounded-xl border border-emerald-500/10 space-y-1">
                        <span className="block text-[9px] text-emerald-400/60 uppercase font-black tracking-widest font-mono">Profit</span>
                        <span className="text-base font-bold text-emerald-400 mono tracking-tighter">${analysis.signal.takeProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <span className="text-[10px] text-slate-500 uppercase tracking-[0.4em] font-bold flex items-center gap-2">Thesis</span>
                    <p className="text-sm text-slate-300 leading-relaxed italic font-medium bg-slate-900/40 p-5 rounded-2xl border border-slate-800/50 font-mono">
                      "{analysis.signal.reasoning}"
                    </p>
                  </div>
                </div>

                <div className="mt-auto pt-8 text-[9px] text-slate-700 flex justify-between font-mono uppercase tracking-[0.4em] font-bold">
                  <span>Logic_v6.0.FLOW</span>
                  <span>{lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-600 text-center space-y-8 py-10">
                <div className="p-8 bg-slate-900/50 rounded-full border border-slate-800 opacity-20">
                  <ICONS.Info size={48} />
                </div>
                <div className="space-y-3">
                  <p className="text-[10px] font-mono uppercase tracking-[0.6em] text-slate-500 font-black">Ready for Flow Synthesis</p>
                  <p className="text-[10px] text-slate-700 italic max-w-[220px] mx-auto uppercase tracking-widest leading-loose font-mono">
                    Awaiting trigger for structural flow analysis of {selectedSymbol}.
                  </p>
                </div>
                <button 
                  onClick={runAnalysis}
                  disabled={!marketData || fetchingData}
                  className="group relative px-12 py-4 overflow-hidden rounded-2xl transition-all duration-300 active:scale-95 disabled:opacity-30"
                >
                  <div className="absolute inset-0 bg-sky-500" />
                  <span className="relative z-10 text-white text-[11px] font-black uppercase tracking-[0.4em]">
                    {fetchingData ? 'BUFFERING...' : 'INVOKE_ORACLE'}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="relative z-10 pt-10">
        <div className="flex items-center justify-between mb-8">
          <div className="space-y-1">
             <h2 className="text-xl font-black text-white tracking-tighter uppercase flex items-center gap-3">
               <ICONS.Shield className="text-sky-500 w-5 h-5" />
               Signal Ledger
             </h2>
             <p className="text-slate-500 text-[9px] uppercase tracking-[0.3em] font-mono">Historical Output Archives</p>
          </div>
          <button 
            onClick={clearHistory}
            className="text-[9px] font-black text-rose-500/50 hover:text-rose-500 transition-colors uppercase tracking-[0.2em] border border-rose-500/10 px-4 py-2 rounded-xl"
          >
            [Purge History]
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {signalHistory.length === 0 ? (
            <div className="col-span-full py-12 border-2 border-dashed border-slate-900 rounded-3xl flex flex-col items-center justify-center gap-3 opacity-30">
              <ICONS.Info size={24} className="text-slate-700" />
              <p className="text-[10px] font-mono uppercase tracking-[0.4em] text-slate-700 font-black">Ledger Empty</p>
            </div>
          ) : (
            signalHistory.map((entry) => (
              <div key={entry.id} className="glass-effect rounded-2xl p-5 border border-slate-800/40 hover:border-sky-500/30 transition-all group">
                <div className="flex justify-between items-start mb-4">
                  <div className="space-y-1">
                    <span className="block text-[10px] font-black text-white group-hover:text-sky-400 transition-colors">{entry.symbol}</span>
                    <span className="block text-[8px] text-slate-500 font-mono">{new Date(entry.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <span className={`text-[8px] px-2 py-0.5 rounded border font-black tracking-widest ${getSignalBadge(entry.type)}`}>
                    {entry.type}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-slate-950/50 p-2 rounded-lg border border-slate-900/50">
                    <span className="block text-[7px] text-slate-600 uppercase font-black tracking-widest mb-1">Conf</span>
                    <span className="text-[10px] text-sky-400 font-mono font-bold">{(entry.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <div className="bg-slate-950/50 p-2 rounded-lg border border-slate-900/50">
                    <span className="block text-[7px] text-slate-600 uppercase font-black tracking-widest mb-1">Entry</span>
                    <span className="text-[10px] text-white font-mono font-bold">${entry.entry.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  </div>
                </div>

                <div className="text-[9px] text-slate-400 line-clamp-2 leading-relaxed italic font-mono opacity-60">
                  "{entry.reasoning}"
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <footer className="mt-20 text-center pb-16 border-t border-slate-950 pt-16 relative z-10">
        <div className="flex flex-wrap justify-center gap-16 mb-10 opacity-30 grayscale hover:grayscale-0 hover:opacity-100 transition-all duration-700">
          <div className="flex items-center gap-3">
             <ICONS.Shield size={18} className="text-sky-400" />
             <span className="text-[11px] font-mono text-slate-400 uppercase tracking-[0.4em] font-black">Prop Risk Filter</span>
          </div>
          <div className="flex items-center gap-3">
             <ICONS.Zap size={18} className="text-amber-400" />
             <span className="text-[11px] font-mono text-slate-400 uppercase tracking-[0.4em] font-black">Flow Architecture</span>
          </div>
          <div className="flex items-center gap-3">
             <ICONS.Activity size={18} className="text-emerald-400" />
             <span className="text-[11px] font-mono text-slate-400 uppercase tracking-[0.4em] font-black">EST Timezone</span>
          </div>
        </div>
        <div className="space-y-4">
          <p className="text-slate-800 text-[10px] max-w-2xl mx-auto leading-relaxed uppercase tracking-[0.6em] font-black opacity-40 font-mono">
            Aether Quant | High-Frequency Liquidity Protocol v1.6.0
          </p>
          <div className="flex justify-center gap-6">
            <button 
              onClick={() => setShowVault(true)}
              className="text-[9px] font-bold text-sky-500/50 hover:text-sky-500 transition-colors uppercase tracking-widest border border-sky-500/20 px-6 py-2 rounded-full font-mono"
            >
              [Edit Credentials]
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
