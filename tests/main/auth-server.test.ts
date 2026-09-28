import { describe, it, expect, vi, afterEach } from 'vite-plus/test';
import http from 'http';
import net from 'net';
import {
  startAuthServer,
  stopAuthServer,
  getCallbackEndpoint,
} from '../../src/main/auth-server';

// These tests run the real callback server on a free loopback port.

async function getFreePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function redirectUriFor(port: number, host = 'localhost'): string {
  return `http://${host}:${port}/auth/google/callback`;
}

interface RawResponse {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}

function get(port: number, requestPath: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: requestPath, agent: false },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers }),
        );
      },
    );
    req.on('error', reject);
  });
}

/** Sends a request target Node's http client would refuse to build. */
function sendRaw(port: number, requestLine: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(
        `${requestLine}\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`,
      );
    });
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => (data += chunk));
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

async function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

describe('Auth Server', () => {
  afterEach(() => {
    stopAuthServer();
    vi.restoreAllMocks();
  });

  describe('getCallbackEndpoint', () => {
    it('binds localhost redirect URIs to 127.0.0.1 on their port', () => {
      expect(
        getCallbackEndpoint('http://localhost:12345/auth/google/callback'),
      ).toEqual({
        host: '127.0.0.1',
        port: 12345,
        pathname: '/auth/google/callback',
      });
    });

    it('supports IPv6 loopback and the default port', () => {
      expect(getCallbackEndpoint('http://[::1]/cb')).toEqual({
        host: '::1',
        port: 80,
        pathname: '/cb',
      });
    });

    it.each([
      'not a url',
      'https://localhost:12345/cb',
      'http://example.com:12345/cb',
      'http://0.0.0.0:12345/cb',
      'http://constructor:12345/cb',
    ])('rejects %s', (uri) => {
      expect(() => getCallbackEndpoint(uri)).toThrow();
    });
  });

  it('listens on the loopback port of the redirect URI', async () => {
    const port = await getFreePort();
    await startAuthServer(redirectUriFor(port));

    const res = await get(port, '/auth/google/callback?code=abc');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('abc');
    expect(res.body).toContain('Authentication Successful');
  });

  it('only matches the redirect URI path', async () => {
    const port = await getFreePort();
    await startAuthServer(`http://127.0.0.1:${port}/custom/callback`);

    expect((await get(port, '/auth/google/callback?code=1')).status).toBe(404);
    expect((await get(port, '/custom/callback?code=1')).status).toBe(200);
  });

  it('answers a malformed request target with 400 instead of crashing', async () => {
    const port = await getFreePort();
    await startAuthServer(redirectUriFor(port));

    const response = await sendRaw(port, 'GET http://[ HTTP/1.1');
    expect(response).toMatch(/^HTTP\/1\.1 400/);
    // Still serving afterwards.
    expect((await get(port, '/other')).status).toBe(404);
  });

  it('rejects a callback without a code', async () => {
    const port = await getFreePort();
    await startAuthServer(redirectUriFor(port));

    const res = await get(port, '/auth/google/callback');
    expect(res.status).toBe(400);
    expect(res.body).toBe('Missing code parameter');
    expect(await isListening(port)).toBe(true);
  });

  it('escapes HTML in the code parameter', async () => {
    const port = await getFreePort();
    await startAuthServer(redirectUriFor(port));

    const dangerousCode = '<script>alert("xss")</script>';
    const res = await get(
      port,
      `/auth/google/callback?code=${encodeURIComponent(dangerousCode)}`,
    );
    expect(res.body).toContain(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
    expect(res.body).not.toContain(dangerousCode);
    expect(res.body).toContain('Copied!');
  });

  it('stops listening once the code has been shown', async () => {
    const port = await getFreePort();
    await startAuthServer(redirectUriFor(port));

    await get(port, '/auth/google/callback?code=abc');
    await vi.waitFor(async () => expect(await isListening(port)).toBe(false));
  });

  it('can be started again after it stopped', async () => {
    const port = await getFreePort();
    await startAuthServer(redirectUriFor(port));
    await get(port, '/auth/google/callback?code=abc');
    await vi.waitFor(async () => expect(await isListening(port)).toBe(false));

    await startAuthServer(redirectUriFor(port));
    expect((await get(port, '/auth/google/callback?code=def')).status).toBe(
      200,
    );
  });

  it('shuts down when no callback arrives in time', async () => {
    const port = await getFreePort();
    await startAuthServer(redirectUriFor(port), undefined, 50);

    expect(await isListening(port)).toBe(true);
    await vi.waitFor(async () => expect(await isListening(port)).toBe(false));
  });

  it('reuses a pending server instead of binding twice', async () => {
    const port = await getFreePort();
    const createServer = vi.spyOn(http, 'createServer');
    await startAuthServer(redirectUriFor(port));
    await startAuthServer(redirectUriFor(port));

    expect(createServer).toHaveBeenCalledTimes(1);
    expect(await isListening(port)).toBe(true);
  });

  it('rejects when the port is taken, and can be retried later', async () => {
    const port = await getFreePort();
    const blocker = net.createServer();
    await new Promise<void>((resolve) =>
      blocker.listen(port, '127.0.0.1', resolve),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(startAuthServer(redirectUriFor(port))).rejects.toThrow(
        /EADDRINUSE/,
      );
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }

    await startAuthServer(redirectUriFor(port));
    expect((await get(port, '/auth/google/callback?code=abc')).status).toBe(
      200,
    );
  });

  it('rejects redirect URIs that are not on localhost', async () => {
    await expect(
      startAuthServer('https://example.com/auth/google/callback'),
    ).rejects.toThrow(/localhost/);
  });

  it('stopAuthServer is a no-op without a server', () => {
    expect(() => stopAuthServer()).not.toThrow();
  });

  describe('OAuth state validation', () => {
    const start = async (getExpectedState: () => string | null) => {
      const port = await getFreePort();
      await startAuthServer(redirectUriFor(port), getExpectedState);
      return port;
    };

    it('accepts a callback with the expected state', async () => {
      const port = await start(() => 'expected-state');
      const res = await get(
        port,
        '/auth/google/callback?code=123&state=expected-state',
      );
      expect(res.status).toBe(200);
    });

    it('rejects a callback with a mismatched state and keeps listening', async () => {
      const port = await start(() => 'expected-state');
      const res = await get(
        port,
        '/auth/google/callback?code=123&state=attacker-state',
      );
      expect(res.status).toBe(400);
      expect(res.body).toBe('Invalid state parameter');
      expect(await isListening(port)).toBe(true);
    });

    it('rejects a callback with a missing state', async () => {
      const port = await start(() => 'expected-state');
      const res = await get(port, '/auth/google/callback?code=123');
      expect(res.status).toBe(400);
    });

    it('rejects a callback when no flow is pending', async () => {
      const port = await start(() => null);
      const res = await get(
        port,
        '/auth/google/callback?code=123&state=anything',
      );
      expect(res.status).toBe(400);
    });
  });
});
