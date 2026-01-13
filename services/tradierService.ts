
export interface TradierQuote {
  symbol: string;
  last: number;
  change: number;
  change_percentage: number;
  volume: number;
  description: string;
}

export interface TradierBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class TradierService {
  private baseUrl: string;
  private token: string;

  constructor(token: string, isSandbox: boolean = false) {
    this.token = token;
    this.baseUrl = isSandbox 
      ? 'https://sandbox.tradier.com/v1' 
      : 'https://api.tradier.com/v1';
  }

  private async fetchTradier(endpoint: string, method: string = 'GET', body?: any) {
    try {
      const options: RequestInit = {
        method,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/json'
        }
      };

      if (body) {
        options.body = JSON.stringify(body);
        options.headers = { ...options.headers, 'Content-Type': 'application/json' };
      }

      const response = await fetch(`${this.baseUrl}${endpoint}`, options);

      if (!response.ok) {
        let errorMessage = `Tradier Error ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json();
          // Tradier often returns errors in a nested structure
          if (errorData.errors && errorData.errors.error) {
             errorMessage = Array.isArray(errorData.errors.error) 
               ? errorData.errors.error.join(', ') 
               : errorData.errors.error;
          } else if (errorData.fault && errorData.fault.faultstring) {
             errorMessage = errorData.fault.faultstring;
          }
        } catch (e) {
          // If not JSON, use raw text if available
          const text = await response.text();
          if (text) errorMessage = text.substring(0, 100);
        }

        if (response.status === 401) throw new Error(`Authentication Failed: ${errorMessage}`);
        if (response.status === 403) throw new Error(`Forbidden Access: ${errorMessage}`);
        if (response.status === 429) throw new Error(`Rate Limit Exceeded: ${errorMessage}`);
        
        throw new Error(errorMessage);
      }

      const data = await response.json();
      return data;
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error('Network link to Tradier severed');
    }
  }

  async getQuotes(symbols: string[]): Promise<TradierQuote[]> {
    const data = await this.fetchTradier(`/markets/quotes?symbols=${symbols.join(',')}`);
    if (!data.quotes || !data.quotes.quote) return [];
    const quotes = data.quotes.quote;
    return Array.isArray(quotes) ? quotes : [quotes];
  }

  async getIntradayHistory(symbol: string): Promise<TradierBar[]> {
    const now = new Date();
    const start = new Date();
    start.setDate(now.getDate() - 6);

    const datePart = start.toISOString().split('T')[0];
    const startStr = `${datePart} 09:30`;
    
    const data = await this.fetchTradier(`/markets/timesales?symbol=${symbol}&interval=1min&start=${startStr}&session=true`);
    
    if (!data.series || !data.series.data) {
      console.warn("No session data found for", symbol);
      return [];
    }
    
    const results = Array.isArray(data.series.data) ? data.series.data : [data.series.data];
    
    return results.map((item: any) => ({
      date: item.time,
      open: item.open || item.price,
      high: item.high || item.price,
      low: item.low || item.price,
      close: item.close || item.price,
      volume: item.volume
    }));
  }
}
