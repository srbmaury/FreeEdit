const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');

test('file identity hashes every chunk, including the final partial chunk', async () => {
  const {fingerprintSource} = await import('../frontend/source-identity.mjs');
  const bytes = Buffer.alloc(4 * 1024 * 1024 + 3, 7);
  const blob = new Blob([bytes]);
  blob.name = 'movie.mkv';
  const hashes = [bytes.subarray(0, 4*1024*1024), bytes.subarray(4*1024*1024)]
    .map(chunk => createHash('sha256').update(chunk).digest());
  const identity = await fingerprintSource(blob);
  assert.equal(identity.fingerprint, createHash('sha256').update(Buffer.concat(hashes)).digest('hex'));
  assert.equal(identity.size, bytes.length);
  bytes[bytes.length - 1] = 8;
  const changed = new Blob([bytes]);
  assert.notEqual((await fingerprintSource(changed)).fingerprint, identity.fingerprint);
});

test('unreadable files fail instead of yielding an identity', async () => {
  const {fingerprintSource} = await import('../frontend/source-identity.mjs');
  await assert.rejects(fingerprintSource({size:1,slice(){throw Error('unreadable');}}), /unreadable/);
});
