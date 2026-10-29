import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeYouTubeUrl, looksLikeUrl, displayDuration } from '../src/youtube.js';

const id = 'dQw4w9WgXcQ';
const canonical = `https://www.youtube.com/watch?v=${id}`;

test('normalizes common individual YouTube video links', () => {
  assert.equal(normalizeYouTubeUrl(`https://youtu.be/${id}?t=11`), canonical);
  assert.equal(normalizeYouTubeUrl(`https://www.youtube.com/watch?v=${id}&list=PLx`), canonical);
  assert.equal(normalizeYouTubeUrl(`https://music.youtube.com/watch?v=${id}`), canonical);
  assert.equal(normalizeYouTubeUrl(`https://youtube.com/shorts/${id}`), canonical);
});

test('rejects invalid or non-YouTube sources', () => {
  assert.equal(normalizeYouTubeUrl('https://evil.example/watch?v=' + id), null);
  assert.equal(normalizeYouTubeUrl('https://www.youtube.com.evil.example/watch?v=' + id), null);
  assert.equal(normalizeYouTubeUrl('https://youtube.com/playlist?list=ABC'), null);
  assert.equal(normalizeYouTubeUrl('file:///etc/passwd'), null);
  assert.equal(normalizeYouTubeUrl('not a url'), null);
  assert.equal(looksLikeUrl('https://example.com'), true);
  assert.equal(looksLikeUrl('song name'), false);
});

test('formats durations', () => {
  assert.equal(displayDuration(62), '1:02');
  assert.equal(displayDuration(3661), '1:01:01');
  assert.equal(displayDuration(null), 'live/unknown');
});
