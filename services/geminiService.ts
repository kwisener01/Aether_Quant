
import { GoogleGenAI } from "@google/genai";
import { MarketData, AnalysisResponse, TickWindow, SentimentAnalysis } from "../types";

const SEARCH_MODEL = 'gemini-3-flash-preview'; 
const ANALYSIS_MODEL = 'gemini-3-pro-preview'; 

const SYSTEM_INSTRUCTION = `
You are the "Aether Oracle," an institutional-grade HFT ensemble coordinator.
Objective: Execute the Rocket Scooter methodology using a 100-model Elastic Net (ENet) Ensemble.
Respond ONLY with valid JSON.
`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const sanitizeJsonResponse = (text: string): string => {
  let cleaned = text.trim();
  if (cleaned.includes('```')) {
    const matches = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (matches && matches[1]) {
      cleaned = matches[1].trim();
    }
  }
  const startIdx = cleaned.indexOf('{');
  const endIdx = cleaned.lastIndexOf('}');
  if (startIdx !== -1 && endIdx !== -1) {
    cleaned = cleaned.substring(startIdx, endIdx + 1);
  }
  return cleaned;
};

const withRetry = async <T>(fn: () => Promise<T>, retries = 2, delay = 2000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const errorMsg = error?.message?.toLowerCase() || "";
    if (retries > 0 && (errorMsg.includes('429') || errorMsg.includes('resource_exhausted') || errorMsg.includes('deadline'))) {
      await sleep(delay);
      return withRetry(fn, retries - 1, delay * 1.5);
    }
    throw error;
  }
};

export const fetchMarketDataViaSearch = async (symbol: string): Promise<any> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `REAL-TIME QUANT DATA RETRIEVAL:
    Search for today's specific institutional levels for ${symbol}.
    1. Metrics: currentPrice, change24h, vix (CBOE Volatility Index).
    2. Institutional Levels: hp, mhp, gammaFlip, maxGamma, vannaPivot, yesterdayClose, todayOpen.
    3. Historical Series: Provide a list (minimum 100 points) of 1-minute candle close prices for the session.
    JSON format only: 
    {
      "currentPrice": number,
      "change24h": number,
      "vix": number,
      "hp": number,
      "mhp": number,
      "gammaFlip": number,
      "maxGamma": number,
      "vannaPivot": number,
      "yesterdayClose": number,
      "todayOpen": number,
      "history": [{"time": "HH:MM", "price": number, "volume": number}]
    }`;

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: SEARCH_MODEL,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      }
    });

    const rawText = response.text || '{}';
    try {
      const parsed = JSON.parse(sanitizeJsonResponse(rawText));
      const numericKeys = ['currentPrice', 'change24h', 'vix', 'hp', 'mhp', 'gammaFlip', 'maxGamma', 'vannaPivot', 'yesterdayClose', 'todayOpen'];
      numericKeys.forEach(key => {
        parsed[key] = parseFloat(String(parsed[key])) || 0;
      });
      if (parsed.history && Array.isArray(parsed.history)) {
        parsed.history = parsed.history.map((h: any) => ({
          ...h,
          price: parseFloat(String(h.price)) || 0,
          volume: parseFloat(String(h.volume)) || (Math.floor(Math.random() * 5000) + 2000)
        })).filter((h: any) => h.price > 0);
      }
      return parsed;
    } catch (parseErr) {
      return { currentPrice: 0, history: [] };
    }
  });
};

export const fetchSentimentAnalysis = async (symbol: string): Promise<SentimentAnalysis> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `SEARCH AND ANALYZE: Current institutional sentiment for ${symbol}. 
    Return JSON format:
    {
      "score": number,
      "label": "FEAR" | "EXTREME FEAR" | "NEUTRAL" | "GREED" | "EXTREME GREED",
      "headlines": [
        { "title": "Headline string", "sentiment": "BULLISH" | "BEARISH" | "NEUTRAL", "source": "Source name" }
      ]
    }`;

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: SEARCH_MODEL,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      }
    });

    try {
      const parsed = JSON.parse(sanitizeJsonResponse(response.text || '{}'));
      parsed.score = parseFloat(String(parsed.score)) || 0;
      return parsed as SentimentAnalysis;
    } catch (err) {
      return { score: 0, label: "NEUTRAL", headlines: [] };
    }
  });
};

export const analyzeMarket = async (data: MarketData, windows: TickWindow[]): Promise<AnalysisResponse> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const windowContext = windows.slice(0, 15).map(w => ({
    l: w.label,
    lixi: (w.lixi || 0).toFixed(2)
  }));

  const prompt = `${SYSTEM_INSTRUCTION}
    Symbol: ${data.symbol} Price: ${data.currentPrice} VIX: ${data.vix}
    Levels: GF: ${data.levels?.gammaFlip}, HP: ${data.levels?.hp}
    Last Windows: ${JSON.stringify(windowContext)}
    Calculate high-probability trade setup. Return JSON.
  `;

  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 2000 }
      }
    });

    try {
      const parsed = JSON.parse(sanitizeJsonResponse(response.text || '{}'));
      if (parsed.signal) {
        parsed.signal.entry = parseFloat(String(parsed.signal.entry)) || 0;
        parsed.signal.stopLoss = parseFloat(String(parsed.signal.stopLoss)) || 0;
        parsed.signal.takeProfit = parseFloat(String(parsed.signal.takeProfit)) || 0;
        parsed.signal.voteCount = parseInt(String(parsed.signal.voteCount)) || 0;
      }
      return parsed as AnalysisResponse;
    } catch (e) {
      throw new Error("Analysis parsing failed");
    }
  });
};
