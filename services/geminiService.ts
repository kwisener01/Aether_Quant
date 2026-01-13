
import { GoogleGenAI, Type } from "@google/genai";
import { MarketData, AnalysisResponse } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

const SYSTEM_INSTRUCTION = `
You are the "Aether Oracle," an institutional quant bot designed to exploit structural liquidity and dealer hedging flows in SPY and QQQ.

CORE STRATEGY (Institutional Flow Architecture):
1. SEMANTIC LIQUIDITY: Identify Fair Value Gaps (FVG) and Stop Hunts (Liquidity Grabs).
2. FLOW ARCHITECTURE (Gamma/Vanna):
   - Analyze "Dealer Hedging Gravity": High Gamma strikes act as magnets or pins.
   - Look for "Gamma Flip" zones: Prices where market maker delta hedging shifts from stabilizing to accelerating.
   - Vanna Context: Account for "Vanna Squeezes" where a drop in Implied Volatility (VIX) forces dealers to buy back hedges, driving price higher regardless of news.
3. REASONING DEPTH:
   - Identify if the current move is "Organic Demand" or "Dealer Covering."
   - Prioritize entries at "Unfilled Liquidity Voids" near major Gamma levels.

PROP FIRM PROTECTION:
- Max risk per trade: 0.5% - 1.0%.
- Minimum Reward-to-Risk: 3:1.
- Avoid trading in "Gamma Neutral" chop zones.

Respond ONLY with valid JSON. Do not include any text outside the JSON block.
`;

const sanitizeJsonResponse = (text: string): string => {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  return cleaned;
};

export const fetchMarketDataViaSearch = async (symbol: string): Promise<Partial<MarketData> & { sources: any[] }> => {
  const prompt = `Find current price, 24h change, and VIX for ${symbol}. 
  CRITICAL: Also find the current estimated Total Gamma Exposure (GEX) in billions and the Vanna exposure level for ${symbol}. 
  Provide these as numeric values. 
  In the history array, provide exactly 15 key historical intervals with their estimated GEX and Vanna metrics.`;
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", // Switched to Flash for faster search extraction
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            currentPrice: { type: Type.NUMBER },
            change24h: { type: Type.NUMBER },
            vix: { type: Type.NUMBER },
            gamma: { type: Type.NUMBER },
            vanna: { type: Type.NUMBER },
            history: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  time: { type: Type.STRING },
                  price: { type: Type.NUMBER },
                  volume: { type: Type.NUMBER },
                  gamma: { type: Type.NUMBER },
                  vanna: { type: Type.NUMBER }
                }
              }
            }
          },
          required: ["currentPrice", "change24h", "vix", "history", "gamma", "vanna"]
        }
      }
    });

    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const rawText = response.text || '{}';
    const sanitizedText = sanitizeJsonResponse(rawText);
    const data = JSON.parse(sanitizedText);
    
    return { ...data, symbol, sources };
  } catch (error) {
    console.error("Search-based data fetch failed:", error);
    throw error;
  }
};

export const analyzeMarket = async (data: MarketData): Promise<AnalysisResponse> => {
  const prunedHistory = data.history.slice(-30).map(h => ({ 
    p: h.price, 
    t: h.time, 
    g: h.gamma, 
    v: h.vanna 
  }));

  const prompt = `
    MARKET SNAPSHOT:
    Symbol: ${data.symbol} | Price: $${data.currentPrice} | VIX: ${data.vix.toFixed(2)}
    Flow Metrics: Gamma(GEX): ${data.gamma}bn | Vanna: ${data.vanna}
    
    HISTORICAL SEQUENCE (SAMPLING):
    ${JSON.stringify(prunedHistory)}
    
    TASKS:
    1. Assess Dealer Hedging positioning.
    2. Identify the "Path of Least Resistance."
    3. Output a high-conviction trade setup with 3:1 RR.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview", // Use Pro for the actual "Oracle" logic
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        // Added thinkingBudget to allow the model to reason deeply before outputting JSON
        thinkingConfig: { thinkingBudget: 16384 },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sentiment: { type: Type.STRING },
            liquidityScore: { type: Type.NUMBER },
            signal: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
                entry: { type: Type.NUMBER },
                stopLoss: { type: Type.NUMBER },
                takeProfit: { type: Type.NUMBER },
                reasoning: { type: Type.STRING },
                liquidityZone: { type: Type.STRING }
              },
              required: ["type", "confidence", "entry", "stopLoss", "takeProfit", "reasoning", "liquidityZone"]
            },
            macroFactors: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["sentiment", "liquidityScore", "signal", "macroFactors"]
        }
      }
    });

    const rawText = response.text || '{}';
    const sanitizedText = sanitizeJsonResponse(rawText);
    return JSON.parse(sanitizedText) as AnalysisResponse;
  } catch (error) {
    console.error("Gemini analysis failed:", error);
    throw error;
  }
};
