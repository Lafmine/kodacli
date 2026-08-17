import type {ChatProvider, ProviderConfig} from '../core/types.js';
import {DemoProvider} from './demo.js';
import {GenApiProvider} from './genapi.js';

export function createProvider(config: ProviderConfig): ChatProvider {
  if (config.provider === 'demo') return new DemoProvider();
  if (config.provider === 'genapi') {
    const apiKey = process.env.KODA_API_KEY;
    if (!apiKey) throw new Error('KODA_API_KEY is not set. Add it to your environment or switch provider to demo.');
    return new GenApiProvider({apiKey, baseUrl: config.baseUrl});
  }
  throw new Error(`Provider "${config.provider}" is not installed. Add an adapter before selecting it.`);
}
