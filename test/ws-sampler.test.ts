import { describe, it, expect } from 'vitest';
import { sampleWebSocket } from '../src/ws-sampler';

describe('sampleWebSocket', () => {
  it('returns connected=false with error when WebSocket fails', async () => {
    const result = await sampleWebSocket('wss://invalid.example.com/ws', 100);
    expect(result.connected).toBe(false);
    expect(result.error).toBeDefined();
  });
});
