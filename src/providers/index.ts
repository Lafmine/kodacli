import type {ChatProvider, ProviderConfig} from '../core/types.js';
import {DemoProvider} from './demo.js';
import {GenApiProvider} from './genapi.js';
import {PUBLIC_TEST_API_KEY} from './public-test-key.js';

export function createProvider(config: ProviderConfig): ChatProvider {
  if (config.provider === 'demo') return new DemoProvider();
  if (config.provider === 'genapi') {
    const apiKey = process.env.KODA_API_KEY || PUBLIC_TEST_API_KEY;
    return new GenApiProvider({apiKey, baseUrl: config.baseUrl});
  }
  throw new Error(`Provider "${config.provider}" is not installed. Add an adapter before selecting it.`);
}
