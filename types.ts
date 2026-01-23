
export enum MarketSentiment {
  BULLISH = 'BULLISH',
  BEARISH = 'BEARISH',
  NEUTRAL = 'NEUTRAL',
  VOLATILE = 'VOLATILE'
}

export enum TickLabel {
  UPWARDS = 'UPWARDS',
  DOWNWARDS = 'DOWNWARDS',
  STATIONARY = 'STATIONARY'
}

export interface Tick {
  time: number;
  bid: number;
  ask: number;
  last: number;
  mid: number;
  volume: number;
  bidVolume: number;
  askVolume: number;
  spread: number;
}

export interface TickWindow {
  id: string;
  ticks: Tick[];
  meanMid: number;
  features: {
    v1_mid: number;
    v2_spread: number;
    v3_crossing_return: number;
    v9_volatility: number;
    v10_intensity: number;
    v14_ask_vol: number;
    v15_bid_vol: number;
    v11_22_derivatives: number[];
  };
  lixi: number;
  label: TickLabel;
  ratio: number;
  timestamp: string;
}

export interface PricePoint {
  time: string;
  price: number;
  volume: number;
  gamma?: number; 
  vanna?: number; 
}

export interface InstitutionalLevels {
  hp: number; 
  mhp: number; 
  hg: number; 
  gammaFlip: number; 
  maxGamma: number; 
  vannaPivot: number; 
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'SQUEEZE';
}

export interface EnsembleInsight {
  category: string;
  weight: number;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  description: string;
}

export interface Signal {
  type: 'BUY' | 'SELL' | 'WAIT';
  confidence: number;
  voteCount: number; 
  entry: number;
  stopLoss: number;
  takeProfit: number;
  reasoning: string;
  liquidityZone: string;
  executionStatus: 'RISK ON' | 'SIT OUT';
  isGoldenSetup: boolean;
  ensembleInsights?: EnsembleInsight[];
}

export interface HistoricalSignal extends Signal {
  id: string;
  symbol: string;
  timestamp: string;
  chartTime: string;
  priceAtSignal: number;
}

export interface MarketData {
  symbol: string;
  currentPrice: number;
  change24h: number;
  volume24h: number;
  vix: number;
  history: PricePoint[];
  levels?: InstitutionalLevels;
}

export interface AnalysisResponse {
  sentiment: MarketSentiment;
  liquidityScore: number;
  signal: Signal;
  macroFactors: string[];
}

export interface Alert {
  id: string;
  type: 'GOLDEN' | 'SIGNAL' | 'SYSTEM';
  message: string;
  timestamp: string;
}

export interface PropChallengeStats {
  startingBalance: number;
  currentEquity: number;
  profitTarget: number;
  maxDrawdown: number;
  currentDrawdown: number;
  dailyLossLimit: number;
  status: 'PASSING' | 'FAILING' | 'ACTIVE';
}
