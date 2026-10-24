// packages/api/src/test-helpers/smtp-sink.ts
// A tiny SMTP server for tests (spec 2026-10-24 email §5: an in-process sink, no Docker). It speaks just enough of
// RFC 5321 for nodemailer — EHLO/HELO, MAIL, RCPT, DATA, RSET, NOOP, QUIT; no TLS, no AUTH — and keeps what it got.
// `failNext` answers that many messages with a temporary 451; `silent` accepts connections and never greets.
import { createServer, type AddressInfo, type Socket } from 'node:net';

export type SunkMessage = { from: string; to: string[]; data: string };
export type SmtpSink = { url: string; messages: SunkMessage[]; failNext: number; silent: boolean; close(): Promise<void> };

export async function startSmtpSink(): Promise<SmtpSink> {
  const sockets = new Set<Socket>();
  const sink: SmtpSink = { url: '', messages: [], failNext: 0, silent: false, close: async () => {} };
  const server = createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => {});
    if (sink.silent) return;
    sock.setEncoding('utf8');
    const say = (line: string) => { if (!sock.destroyed) sock.write(`${line}\r\n`); };
    const fresh = (): SunkMessage => ({ from: '', to: [], data: '' });
    let buf = '';
    let inData = false;
    let cur = fresh();
    say('220 sink.test ESMTP');
    sock.on('data', (chunk: string) => {
      buf += chunk;
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          cur.data = buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          if (sink.failNext > 0) { sink.failNext--; say('451 4.3.0 Try again later'); } else { sink.messages.push(cur); say('250 2.0.0 Queued'); }
          cur = fresh();
          continue;
        }
        const nl = buf.indexOf('\r\n');
        if (nl < 0) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const verb = line.slice(0, 4).toUpperCase();
        const address = () => /<([^>]*)>/.exec(line)?.[1] ?? '';
        if (verb === 'EHLO') { say('250-sink.test'); say('250 8BITMIME'); }
        else if (verb === 'HELO') say('250 sink.test');
        else if (verb === 'MAIL') { cur.from = address(); say('250 2.1.0 OK'); }
        else if (verb === 'RCPT') { cur.to.push(address()); say('250 2.1.5 OK'); }
        else if (verb === 'DATA') { inData = true; say('354 End data with <CR><LF>.<CR><LF>'); }
        else if (verb === 'RSET') { cur = fresh(); say('250 2.0.0 OK'); }
        else if (verb === 'QUIT') { say('221 2.0.0 Bye'); sock.end(); return; }
        else say('250 2.0.0 OK');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  sink.url = `smtp://127.0.0.1:${(server.address() as AddressInfo).port}`;
  sink.close = async () => {
    for (const s of sockets) s.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return sink;
}
