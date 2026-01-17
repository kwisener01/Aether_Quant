
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
  // Feature Vector V1-V22
  features: {
    v1_mid: number;
    v2_spread: number;
    v3_crossing_return: number;
    v9_volatility: number;
    v10_intensity: number;
    v14_ask_vol: number; // Best Ask Volume
    v15_bid_vol: number; // Best Bid Volume
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
  hp: number; // Weekly Max Gamma
  mhp: number; // Monthly Max Gamma
  hg: number; // Half Gap
  gammaFlip: number; // Gamma Flip Level
  maxGamma: number; // Max Gamma Concentration
  vannaPivot: number; // Vanna Hedging Pivot
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'SQUEEZE';
}

export interface MarketData {
  symbol: string;
  currentPrice: number;
  change24h: number;
  volume24h: number;
  vix: number;
  history: PricePoint[];
  gamma?: number; 
  vanna?: number;
  recentWindows?: TickWindow[];
  levels?: InstitutionalLevels;
}

export interface Signal {
  type: 'BUY' | 'SELL' | 'WAIT';
  confidence: number;
  voteCount: number; // X/100 models
  entry: number;
  stopLoss: number;
  takeProfit: number;
  reasoning: string;
  liquidityZone: string;
  executionStatus: 'RISK ON' | 'SIT OUT';
  isGoldenSetup: boolean;
}

export interface HistoricalSignal extends Signal {
  id: string;
  symbol: string;
  timestamp: string;
  chartTime: string; 
  priceAtSignal: number;
}

export interface AnalysisResponse {
  sentiment: MarketSentiment;
  liquidityScore: number;
  signal: Signal;
  macroFactors: string[];
}
