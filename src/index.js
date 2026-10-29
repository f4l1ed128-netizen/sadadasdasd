import 'dotenv/config';
import path from 'node:path';
import { ChannelType, Client, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import { VoiceConnectionStatus, getVoiceConnection } from '@discordjs/voice';
import { commandData, handleCommand } from './commands.js';
import { SessionManager } from './session.js';
import { StayStore } from './store.js';

const token = process.env.DISCORD_TOKEN;
if (!token || token === 'PASTE_YOUR_BOT_TOKEN_HERE') {
  console.error('Missing DISCORD_TOKEN. Copy .env.example to .env and fill in your token.');
  process.exit(1);
}

const volumeInput = Number(process.env.DEFAULT_VOLUME || '0.65');
const defaultVolume = Number.isFinite(volumeInput) ? Math.min(2, Math.max(0, volumeInput)) : 0.65;
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const manager = new SessionManager(client, defaultVolume);
const stayStore = new StayStore(path.resolve('state/stay-channels.json'));
const recovering = new Set();

async function registerCommands() {
  const guildId = process.env.GUILD_ID?.trim();
  const rest = new REST({ version: '10' }).setToken(token);
  const route = guildId ? Routes.applicationGuildCommands(client.user.id, guildId)
    : Routes.applicationCommands(client.user.id);
  await rest.put(route, { body: commandData });
  console.log(`Registered ${commandData.length} commands ${guildId ? `in guild ${guildId}` : 'globally'}.`);
}

async function restore24x7(guildId, channelId) {
  if (recovering.has(guildId)) return;
  recovering.add(guildId);
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      console.warn(`Saved 24/7 channel ${guildId}/${channelId} is missing or unsupported.`);
      return;
    }
    const conn = getVoiceConnection(guildId);
    if (conn?.joinConfig?.channelId === channelId &&
        [VoiceConnectionStatus.Ready, VoiceConnectionStatus.Connecting, VoiceConnectionStatus.Signalling].includes(conn.state.status)) return;
    await manager.get(guildId).connect(channel);
    console.log(`24/7: connected to ${guild.name} / ${channel.name}`);
  } catch (error) {
    console.warn(`24/7 rejoin failed in guild ${guildId}:`, error.message);
  } finally {
    recovering.delete(guildId);
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try { await registerCommands(); }
  catch (error) { console.error('Slash command registration failed:', error); }
  for (const [guildId, channelId] of stayStore.entries()) {
    void restore24x7(guildId, channelId);
  }
  // Voice connections recover on brief drops internally. Watchdog handles longer failures.
  setInterval(() => {
    for (const [guildId, channelId] of stayStore.entries()) {
      void restore24x7(guildId, channelId);
    }
  }, 30000).unref();
});

client.on(Events.InteractionCreate, interaction => {
  void handleCommand(interaction, manager, stayStore);
});

client.on(Events.GuildDelete, guild => {
  stayStore.delete(guild.id);
  manager.sessions.get(guild.id)?.leave();
  manager.sessions.delete(guild.id);
});

client.on('error', e => console.error('Discord client error:', e));
process.on('unhandledRejection', e => console.error('Unhandled rejection:', e));

async function shutdown(signal) {
  console.log(`Received ${signal}; closing connections.`);
  for (const session of manager.sessions.values()) session.leave();
  client.destroy();
  process.exit(0);
}
process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

client.login(token).catch(err => {
  console.error('Discord login failed:', err.message);
  process.exitCode = 1;
});
