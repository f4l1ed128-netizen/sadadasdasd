import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Only allow YouTube video URLs, never arbitrary destinations passed to yt-dlp. */
export function normalizeYouTubeUrl(input) {
  let url;
  try { url = new URL(input); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const hostname = url.hostname.toLowerCase();
  let id = null;
  if (hostname === 'youtu.be' || hostname === 'www.youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(hostname)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/live/')) {
      id = url.pathname.split('/')[2];
    }
  }
  return VIDEO_ID.test(id ?? '') ? `https://www.youtube.com/watch?v=${id}` : null;
}

export function looksLikeUrl(input) {
  return /^https?:\/\//i.test(input.trim());
}

function asTrack(info, requestedBy) {
  if (!info || typeof info !== 'object') throw new Error('No playable YouTube video was found.');
  const id = info.id;
  if (!VIDEO_ID.test(id || '')) throw new Error('The result was not a supported YouTube video.');
  return {
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    title: String(info.title || 'Untitled YouTube video').slice(0, 180),
    duration: info.duration != null && Number.isFinite(Number(info.duration)) ? Number(info.duration) : null,
    requestedBy: requestedBy || 'Unknown',
  };
}

/** Search from actual YouTube results using yt-dlp (no API key required). */
export async function searchYouTube(query, requestedBy) {
  const input = query.trim();
  if (!input || input.length > 200) throw new Error('Provide a song title or link (1–200 characters).');
  if (looksLikeUrl(input) && !normalizeYouTubeUrl(input)) {
    throw new Error('Only individual YouTube video links are supported (not playlists or other websites).');
  }
  const link = normalizeYouTubeUrl(input);
  const target = link || `ytsearch1:${input}`;

  let stdout;
  try {
    ({ stdout } = await execFileAsync('yt-dlp', [
      '--no-warnings', '--no-playlist', '--skip-download', '--dump-single-json',
      '--ignore-config', '--', target,
    ], { timeout: 45000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('yt-dlp is not installed or is missing from PATH.');
    if (error.killed) throw new Error('YouTube search timed out. Try again.');
    throw new Error('YouTube could not find or access that video. Check yt-dlp and try another song.');
  }
  let result;
  try { result = JSON.parse(stdout); }
  catch { throw new Error('yt-dlp returned invalid video information.'); }
  const item = result.entries ? result.entries.find((x) => x && x.id) : result;
  return asTrack(item, requestedBy);
}

export function displayDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds == null || seconds < 0) return 'live/unknown';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : `${m}:${String(s % 60).padStart(2, '0')}`;
}
