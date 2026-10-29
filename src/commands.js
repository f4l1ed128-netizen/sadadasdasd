import { ChannelType, PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { getVoiceConnection, AudioPlayerStatus } from '@discordjs/voice';
import { searchYouTube, displayDuration } from './youtube.js';

export const commandData = [
  new SlashCommandBuilder().setName('play').setDescription('Search YouTube or play a YouTube video URL')
    .addStringOption(o => o.setName('query').setDescription('Song name or YouTube video link').setRequired(true).setMaxLength(200)),
  new SlashCommandBuilder().setName('join').setDescription('Join your voice channel'),
  new SlashCommandBuilder().setName('leave').setDescription('Disconnect the bot from voice'),
  new SlashCommandBuilder().setName('skip').setDescription('Skip the current song'),
  new SlashCommandBuilder().setName('pause').setDescription('Pause the current song'),
  new SlashCommandBuilder().setName('resume').setDescription('Resume music'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop playing and empty the queue'),
  new SlashCommandBuilder().setName('queue').setDescription('Show the current song and next queued tracks'),
  new SlashCommandBuilder().setName('nowplaying').setDescription('Show the song currently playing'),
  new SlashCommandBuilder().setName('volume').setDescription('Set playback volume')
    .addIntegerOption(o => o.setName('percent').setDescription('Volume in percent (0–200)').setMinValue(0).setMaxValue(200).setRequired(true)),
  new SlashCommandBuilder().setName('loop').setDescription('Set looping for current song or whole queue')
    .addStringOption(o => o.setName('mode').setDescription('Loop mode').setRequired(true)
      .addChoices({ name: 'Off', value: 'off' }, { name: 'Current song', value: 'song' }, { name: 'Entire queue', value: 'queue' })),
  new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle songs waiting in the queue'),
  new SlashCommandBuilder().setName('remove').setDescription('Remove a song from the waiting queue')
    .addIntegerOption(o => o.setName('position').setDescription('Position as shown in /queue').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('clear').setDescription('Clear the waiting queue without stopping current music'),
  new SlashCommandBuilder().setName('stay').setDescription('24/7 mode: remain connected and rejoin after restart')
    .addStringOption(o => o.setName('mode').setDescription('On, off, or status').setRequired(true)
      .addChoices({ name: 'Enable', value: 'on' }, { name: 'Disable', value: 'off' }, { name: 'Status', value: 'status' })),
].map(command => command.toJSON());

function hasManageServer(interaction) {
  return interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) || false;
}

async function memberVoiceChannel(interaction) {
  const member = await interaction.guild.members.fetch(interaction.user.id);
  return member.voice.channel;
}

function currentVoiceId(interaction) {
  const conn = getVoiceConnection(interaction.guildId);
  return conn?.joinConfig?.channelId || null;
}

async function requireSameVoice(interaction) {
  const userChannel = await memberVoiceChannel(interaction);
  if (!userChannel) throw new Error('Join a voice channel first.');
  if (userChannel.type !== ChannelType.GuildVoice) throw new Error('Use a normal voice channel, not a Stage channel.');
  const botChannel = currentVoiceId(interaction);
  if (botChannel && botChannel !== userChannel.id) {
    throw new Error('Join the same voice channel as the bot before controlling music.');
  }
  return userChannel;
}

function trackLine(track) {
  return `**${track.title}** (${displayDuration(track.duration)}) · requested by ${track.requestedBy}`;
}

function shuffleInPlace(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

export async function handleCommand(interaction, manager, stayStore) {
  if (!interaction.isChatInputCommand() || !interaction.inGuild()) return;
  const name = interaction.commandName;
  const session = manager.get(interaction.guildId);
  const reply = async (content) => {
    const body = { content, allowedMentions: { parse: [] } };
    return interaction.deferred || interaction.replied ? interaction.editReply(body) : interaction.reply(body);
  };
  try {
    if (name === 'play') {
      await interaction.deferReply();
      const voice = await requireSameVoice(interaction);
      if (session.queue.length >= 100) return reply('The queue is full (100 songs).');
      await session.connect(voice);
      session.textChannelId = interaction.channelId;
      const requestedBy = interaction.user.username.replace(/[\r\n@]/g, '').slice(0, 32);
      const track = await searchYouTube(interaction.options.getString('query', true), requestedBy);
      const started = !session.current && session.player.state.status === AudioPlayerStatus.Idle;
      session.enqueue(track);
      return reply(`${started ? '▶️ Starting' : '➕ Queued'} ${trackLine(track)}\n${track.url}`);
    }

    if (name === 'join') {
      await interaction.deferReply();
      const voice = await memberVoiceChannel(interaction);
      if (!voice) throw new Error('Join a voice channel first.');
      if (voice.type !== ChannelType.GuildVoice) throw new Error('Use a normal voice channel, not a Stage channel.');
      if (currentVoiceId(interaction) && currentVoiceId(interaction) !== voice.id && !hasManageServer(interaction)) {
        throw new Error('Only someone with Manage Server permission may move the bot while it is in another channel.');
      }
      await session.connect(voice);
      session.textChannelId = interaction.channelId;
      if (stayStore.get(interaction.guildId)) stayStore.set(interaction.guildId, voice.id);
      return reply(`🔊 Connected to **${voice.name}**.`);
    }

    if (name === 'stay') {
      const mode = interaction.options.getString('mode', true);
      if (mode === 'status') {
        const channelId = stayStore.get(interaction.guildId);
        return reply(channelId ? `🟢 24/7 mode is **on** for <#${channelId}>. (The bot must be hosted continuously.)` : '⚪ 24/7 mode is **off**.');
      }
      if (!hasManageServer(interaction)) throw new Error('Manage Server permission is required to change 24/7 mode.');
      if (mode === 'off') {
        stayStore.delete(interaction.guildId);
        return reply('24/7 mode disabled. The bot will remain connected until you use `/leave` or restart it.');
      }
      await interaction.deferReply();
      const voice = await requireSameVoice(interaction);
      await session.connect(voice);
      session.textChannelId = interaction.channelId;
      stayStore.set(interaction.guildId, voice.id);
      return reply(`♾️ **24/7 mode enabled** in <#${voice.id}>. It will rejoin after bot restarts and check its connection regularly.`);
    }

    if (name === 'queue') {
      const current = session.current ? `🎶 ${trackLine(session.current)}` : 'Nothing playing.';
      const pending = session.queue.slice(0, 10).map((t, i) => `${i + 1}. ${trackLine(t)}`).join('\n');
      return reply(`**Current**\n${current}\n\n**Up next (${session.queue.length})**\n${pending || 'Empty'}${session.queue.length > 10 ? `\n…and ${session.queue.length - 10} more.` : ''}\n**Loop:** ${session.loopMode}`.slice(0, 1950));
    }
    if (name === 'nowplaying') return reply(session.current ? `🎶 ${trackLine(session.current)}\n${session.current.url}` : 'Nothing playing right now.');

    await requireSameVoice(interaction);
    if (!currentVoiceId(interaction)) throw new Error('The bot is not in a voice channel.');

    switch (name) {
      case 'leave':
        if (stayStore.get(interaction.guildId) && !hasManageServer(interaction)) {
          throw new Error('Manage Server permission is required to disconnect the bot while 24/7 mode is enabled.');
        }
        stayStore.delete(interaction.guildId);
        session.leave();
        return reply('👋 Left voice and stopped all music.');
      case 'skip':
        return reply(session.skip() ? '⏭️ Skipped.' : 'Nothing to skip.');
      case 'stop':
        session.stop();
        return reply('⏹️ Stopped playback and cleared the queue.');
      case 'pause':
        return reply(session.player.pause() ? '⏸️ Paused.' : 'Nothing currently playing.');
      case 'resume':
        return reply(session.player.unpause() ? '▶️ Resumed.' : 'Nothing paused.');
      case 'volume': {
        const n = interaction.options.getInteger('percent', true);
        session.volume = n / 100;
        const resource = session.player.state.resource;
        resource?.volume?.setVolume(session.volume);
        return reply(`🔉 Volume set to ${n}%.`);
      }
      case 'loop':
        session.loopMode = interaction.options.getString('mode', true);
        return reply(`🔁 Loop mode: **${session.loopMode}**.`);
      case 'shuffle':
        shuffleInPlace(session.queue);
        return reply(`🔀 Shuffled ${session.queue.length} queued songs.`);
      case 'remove': {
        const pos = interaction.options.getInteger('position', true);
        if (pos > session.queue.length) throw new Error(`The queue contains only ${session.queue.length} waiting songs.`);
        const [removed] = session.queue.splice(pos - 1, 1);
        return reply(`🗑️ Removed **${removed.title}**.`);
      }
      case 'clear':
        session.queue.length = 0;
        return reply('🧹 Cleared the waiting queue.');
      default:
        return reply('Unknown command.');
    }
  } catch (e) {
    console.error(`/${name} command error:`, e);
    try { await reply(`⚠️ ${e.message || 'Something went wrong.'}`.slice(0, 1950)); }
    catch (error) { console.warn('Could not send command error:', error.message); }
  }
}
