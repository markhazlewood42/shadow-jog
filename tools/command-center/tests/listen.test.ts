import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { describe, expect, it } from 'vitest';
import { PortBusyError, startServer } from '../src/server/main';
import { freePort, makeApp, makeTestConfig } from './helpers';

/** Whether a TCP connection to host:port succeeds. A refusal, an unreachable address and a silence all count as no. */
function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolveConnect) => {
    const socket = connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolveConnect(ok);
    };
    socket.setTimeout(1500, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** The IPv4 addresses of this machine's real network cards (not the loopback one). */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
}

describe('startServer', () => {
  it('the server listens on 127.0.0.1 only', async () => {
    const port = await freePort();
    const config = makeTestConfig({ port });
    const { app } = makeApp({ config });
    const server = await startServer(app, port);
    try {
      // The socket is bound to the IPv4 loopback address, not to every address of the machine.
      expect(server.address()).toMatchObject({ address: '127.0.0.1', family: 'IPv4', port });

      // It answers there, under the Host names the app allows.
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(res.status).toBe(200);
      const byName = await fetch(`http://localhost:${port}/api/health`);
      expect(byName.status).toBe(200);

      // Nothing answers on the other addresses of this machine: the IPv6 loopback and each network card.
      expect(await canConnect('::1', port)).toBe(false);
      for (const address of lanAddresses()) {
        expect(await canConnect(address, port), `an address of this machine: ${address}`).toBe(false);
      }
    } finally {
      server.close();
      server.closeAllConnections();
    }
  });

  it('rejects with a PortBusyError that names the port when something else already listens on it', async () => {
    const port = await freePort();
    const first = await startServer(makeApp({ config: makeTestConfig({ port }) }).app, port);
    try {
      const error = await startServer(makeApp({ config: makeTestConfig({ port }) }).app, port).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PortBusyError);
      expect((error as Error).message).toContain(String(port));
      // The first server is untouched: a busy port is reported, nobody is stopped.
      expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
    } finally {
      first.close();
      first.closeAllConnections();
    }
  });
});
