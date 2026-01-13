
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

/**
 * Robust JSON extraction helper to handle cases where the model might wrap response in markdown blocks
 * or include stray characters.
 */
const sanitizeJsonResponse = (text: string): string => {
  let cleaned = text.trim();
  // Remove markdown code blocks if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  return cleaned;
};

export const fetchMarketDataViaSearch = async (symbol: string): Promise<Partial<MarketData> & { sources: any[] }> => {
  // We limit the history to a specific count to prevent the JSON payload from becoming too large and truncating.
  const prompt = `Find current price, 24h change, and VIX for ${symbol}. 
  CRITICAL: Also find the current estimated Total Gamma Exposure (GEX) in billions and the Vanna exposure level for ${symbol}. 
  Provide these as numeric values. 
  In the history array, provide exactly 15 key historical intervals (major pivots or high volume areas) with their estimated GEX and Vanna metrics.`;
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
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
            gamma: { type: Type.NUMBER, description: "Estimated GEX in billions (e.g. 2.5)" },
            vanna: { type: Type.NUMBER, description: "Estimated Vanna exposure level" },
            history: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  time: { type: Type.STRING },
                  price: { type: Type.NUMBER },
                  volume: { type: Type.NUMBER },
                  gamma: { type: Type.NUMBER, description: "Historical GEX at this point" },
                  vanna: { type: Type.NUMBER, description: "Historical Vanna at this point" }
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
  // Prune history to essential points for the analysis prompt to stay within token limits and ensure parsing reliability
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
    1. Assess Dealer Hedging positioning using the provided Gamma/Vanna metrics.
    2. Identify the "Path of Least Resistance" considering liquidity voids.
    3. Output a high-conviction trade setup with 3:1 RR.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
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
