import { spawn } from 'node:child_process';
import {
  AudioPlayerStatus, NoSubscriberBehavior, StreamType,
  VoiceConnectionStatus, createAudioPlayer, createAudioResource,
  entersState, getVoiceConnection, joinVoiceChannel,
} from '@discordjs/voice';
import { displayDuration } from './youtube.js';

const STREAM_TIMEOUT_MS = 30000;

function killProcess(proc) {
  if (proc && !proc.killed && proc.exitCode === null) {
    try { proc.kill('SIGKILL'); } catch { /* already exited */ }
  }
}

/** Each guild has a player and queue completely independent of other guilds. */
export class GuildSession {
  constructor(bot, guildId, defaultVolume) {
    this.bot = bot;
    this.guildId = guildId;
    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    this.queue = [];
    this.current = null;
    this.loopMode = 'off';
    this.volume = defaultVolume;
    this.connection = null;
    this.channelId = null;
    this.textChannelId = null;
    this.downloader = null;
    this.ffmpeg = null;
    this.playbackId = 0;
    this.startTimeout = null;
    this.skipRepeat = false;
    this.starting = false;
    this.connecting = null;

    this.player.on(AudioPlayerStatus.Idle, () => this.onIdle());
    this.player.on('error', (error) => {
      console.error(`[${this.guildId}] Audio error:`, error.message);
      this.notice('⚠️ This video could not be played; trying the next song.');
      this.skipRepeat = true;
      if (!this.player.stop(true)) this.onIdle();
    });
  }

  async connect(channel) {
    if (this.connecting) await this.connecting;
    const task = this._connect(channel);
    this.connecting = task;
    try { return await task; }
    finally { if (this.connecting === task) this.connecting = null; }
  }

  async _connect(channel) {
    const existing = getVoiceConnection(this.guildId);
    if (existing && existing.joinConfig.channelId !== channel.id) {
      this.resetPlayback();
      existing.destroy();
    }
    if (existing && existing.state.status === VoiceConnectionStatus.Disconnected) {
      try { existing.rejoin(); } catch { /* watchdog will retry */ }
    }
    const connection = joinVoiceChannel({
      guildId: this.guildId,
      channelId: channel.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    this.connection = connection;
    this.channelId = channel.id;
    connection.subscribe(this.player);
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 25000);
    } catch (error) {
      if (this.connection === connection) this.connection = null;
      try { connection.destroy(); } catch { /* already destroyed */ }
      throw new Error('Could not connect to voice. Check the bot’s Connect/Speak permissions and network.');
    }
    return connection;
  }

  enqueue(track) {
    this.queue.push(track);
    if (!this.current) this.startNext();
  }

  startNext() {
    if (this.starting || this.current || this.player.state.status !== AudioPlayerStatus.Idle) return;
    const track = this.queue.shift();
    if (!track) return;
    if (!this.connection || this.connection.state.status === VoiceConnectionStatus.Destroyed) {
      this.queue.unshift(track);
      return;
    }
    this.starting = true;
    this.current = track;
    this.skipRepeat = false;
    const id = ++this.playbackId;
    try {
      // yt-dlp handles YouTube segment/network access; FFmpeg receives audio via stdin.
      const ytdlp = spawn('yt-dlp', [
        '--ignore-config', '--no-warnings', '--no-playlist',
        '-f', 'bestaudio/best', '-o', '-', '--', track.url,
      ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const ffmpeg = spawn('ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-i', 'pipe:0', '-vn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1',
      ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      this.downloader = ytdlp;
      this.ffmpeg = ffmpeg;
      ytdlp.stdout.pipe(ffmpeg.stdin);
      // Prevent unhandled EPIPE when FFmpeg exits before yt-dlp.
      ffmpeg.stdin.on('error', () => {});
      ytdlp.stderr.on('data', (data) => console.error(`[yt-dlp ${this.guildId}]`, String(data).trim().slice(0, 500)));
      ffmpeg.stderr.on('data', (data) => console.error(`[ffmpeg ${this.guildId}]`, String(data).trim().slice(0, 500)));
      const failed = (where, reason) => {
        if (this.playbackId !== id || !this.current) return;
        console.error(`[${this.guildId}] ${where}: ${reason}`);
        this.notice(`⚠️ Playback failed (${where}). Skipping **${track.title}**.`);
        this.skipRepeat = true;
        if (!this.player.stop(true)) this.onIdle();
      };
      ytdlp.on('error', (e) => failed('yt-dlp', e.message));
      ffmpeg.on('error', (e) => failed('ffmpeg', e.message));
      ytdlp.on('close', (code) => {
        if (code && this.playbackId === id) failed('yt-dlp', `exit ${code}`);
      });
      ffmpeg.on('close', (code) => {
        if (code && this.playbackId === id) failed('FFmpeg', `exit ${code}`);
      });
      const source = createAudioResource(ffmpeg.stdout, {
        inputType: StreamType.Raw,
        inlineVolume: true,
        metadata: track,
      });
      source.volume?.setVolume(this.volume);
      this.player.play(source);
      this.startTimeout = setTimeout(() => {
        if (this.playbackId === id && this.player.state.status !== AudioPlayerStatus.Playing) {
          failed('timeout', 'no playable audio within 30 seconds');
        }
      }, STREAM_TIMEOUT_MS);
      // A resource can briefly buffer; announce only when actually playing.
      void entersState(this.player, AudioPlayerStatus.Playing, STREAM_TIMEOUT_MS)
        .then(() => { if (this.playbackId === id) this.notice(`🎶 **Now playing:** ${track.title} (${displayDuration(track.duration)})\n${track.url}`); })
        .catch(() => {});
    } catch (error) {
      console.error(`[${this.guildId}] Cannot start track:`, error);
      this.skipRepeat = true;
      if (!this.player.stop(true)) this.onIdle();
    } finally {
      this.starting = false;
    }
  }

  cleanProcesses() {
    if (this.startTimeout) clearTimeout(this.startTimeout);
    this.startTimeout = null;
    if (this.downloader?.stdout && this.ffmpeg?.stdin) this.downloader.stdout.unpipe(this.ffmpeg.stdin);
    killProcess(this.downloader);
    killProcess(this.ffmpeg);
    this.downloader = null;
    this.ffmpeg = null;
  }

  onIdle() {
    if (!this.current) return;
    const finished = this.current;
    const skip = this.skipRepeat;
    // Increment before killing processes: their exit events must not skip the next song.
    ++this.playbackId;
    this.current = null;
    this.skipRepeat = false;
    this.cleanProcesses();
    if (!skip && this.loopMode === 'song') this.queue.unshift(finished);
    else if (!skip && this.loopMode === 'queue') this.queue.push(finished);
    this.startNext();
  }

  skip() {
    if (!this.current) return false;
    this.skipRepeat = true;
    if (!this.player.stop(true)) this.onIdle();
    return true;
  }

  stop() {
    this.queue.length = 0;
    this.skipRepeat = true;
    if (this.current) { if (!this.player.stop(true)) this.onIdle(); }
    else this.cleanProcesses();
  }

  resetPlayback() {
    ++this.playbackId;
    this.current = null;
    this.skipRepeat = true;
    this.queue.length = 0;
    this.cleanProcesses();
    this.player.stop(true);
  }

  leave() {
    this.resetPlayback();
    this.channelId = null;
    if (this.connection) {
      try { this.connection.destroy(); } catch { /* already destroyed */ }
    }
    this.connection = null;
  }

  notice(message) {
    if (!this.textChannelId) return;
    this.bot.channels.fetch(this.textChannelId)
      .then((channel) => channel?.isTextBased()?.send({ content: message, allowedMentions: { parse: [] } }))
      .catch((e) => console.warn(`[${this.guildId}] Could not send notice:`, e.message));
  }
}

export class SessionManager {
  constructor(client, volume) {
    this.client = client;
    this.volume = volume;
    this.sessions = new Map();
  }
  get(guildId) {
    if (!this.sessions.has(guildId)) this.sessions.set(guildId, new GuildSession(this.client, guildId, this.volume));
    return this.sessions.get(guildId);
  }
}
