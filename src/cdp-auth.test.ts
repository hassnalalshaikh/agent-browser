import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright-core';
import { BrowserManager } from './browser.js';
import { createServer } from 'node:http';

describe('CDP transport authentication', () => {
  it('sends credentials through the real local HTTP and WebSocket handshake', async () => {
    const received: Array<{ authorization?: string; pageHeader?: string | string[] }> = [];
    const server = createServer((request, response) => {
      received.push({
        authorization: request.headers.authorization,
        pageHeader: request.headers['x-page-header'],
      });
      const address = server.address() as { port: number };
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          webSocketDebuggerUrl: 'ws://127.0.0.1:' + address.port + '/browser/fixture',
        })
      );
    });
    server.on('upgrade', (request, socket) => {
      received.push({
        authorization: request.headers.authorization,
        pageHeader: request.headers['x-page-header'],
      });
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address() as { port: number };
      await expect(
        new BrowserManager().launch({
          cdpUrl: 'http://127.0.0.1:' + address.port,
          cdpHeaders: { Authorization: 'Bearer offline-fixture' },
          headers: { 'X-Page-Header': 'page-only' },
        })
      ).rejects.toThrow('Failed to connect via CDP');
      expect(received).toEqual([
        { authorization: 'Bearer offline-fixture', pageHeader: undefined },
        { authorization: 'Bearer offline-fixture', pageHeader: undefined },
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  afterEach(() => vi.restoreAllMocks());

  it('passes transport credentials separately from page headers', async () => {
    const connect = vi
      .spyOn(chromium, 'connectOverCDP')
      .mockRejectedValue(new Error('fixture disconnected'));
    await expect(
      new BrowserManager().launch({
        cdpUrl: 'wss://browser.example/cdp',
        cdpHeaders: { Authorization: 'Bearer transport-only' },
        headers: { 'X-Page-Header': 'page-only' },
      })
    ).rejects.toThrow('Failed to connect via CDP');
    expect(connect).toHaveBeenCalledExactlyOnceWith('wss://browser.example/cdp', {
      timeout: undefined,
      headers: { Authorization: 'Bearer transport-only' },
    });
  });

  it('keeps unauthenticated connections compatible', async () => {
    const connect = vi
      .spyOn(chromium, 'connectOverCDP')
      .mockRejectedValue(new Error('fixture disconnected'));
    await expect(new BrowserManager().launch({ cdpUrl: 'ws://localhost:9222' })).rejects.toThrow();
    expect(connect).toHaveBeenCalledExactlyOnceWith('ws://localhost:9222', {
      timeout: undefined,
      headers: undefined,
    });
  });
});
