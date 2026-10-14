import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { downloadWithProgress } from '../dist/main/cli/auto-setup.js';

const BODY = Buffer.alloc(256 * 1024, 7);

describe('downloadWithProgress', () => {
  let server;
  let base;
  let dir;

  before(async () => {
    server = createServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'content-length': BODY.length });
        res.end(BODY);
      } else if (req.url === '/truncated') {
        // Promise more bytes than we send, then drop the connection.
        res.writeHead(200, { 'content-length': BODY.length * 2 });
        res.write(BODY, () => res.socket.destroy());
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    dir = mkdtempSync(path.join(tmpdir(), 'murmur-dl-'));
  });

  after(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the full file and leaves no .part behind', async () => {
    const dest = path.join(dir, 'ok.bin');
    await downloadWithProgress(`${base}/ok`, dest, 'ok');
    assert.deepEqual(readFileSync(dest), BODY);
    assert.equal(existsSync(`${dest}.part`), false);
  });

  it('leaves nothing at the destination when the transfer is cut short', async () => {
    const dest = path.join(dir, 'truncated.bin');
    await assert.rejects(downloadWithProgress(`${base}/truncated`, dest, 'truncated'));
    assert.equal(existsSync(dest), false);
    assert.equal(existsSync(`${dest}.part`), false);
  });

  it('rejects on HTTP errors without creating a file', async () => {
    const dest = path.join(dir, 'missing.bin');
    await assert.rejects(downloadWithProgress(`${base}/missing`, dest, 'missing'), /HTTP 404/);
    assert.equal(existsSync(dest), false);
  });
});
