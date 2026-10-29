import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StayStore } from '../src/store.js';

test('stores and loads 24/7 voice channel after restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-bot-test-'));
  const file = path.join(dir, 'state', 'stay.json');
  try {
    const store = new StayStore(file);
    store.set('12345', '67890');
    assert.equal(new StayStore(file).get('12345'), '67890');
    store.delete('12345');
    assert.equal(new StayStore(file).get('12345'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
