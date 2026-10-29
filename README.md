# Discord YouTube Music Bot (24/7)

A self-hosted Discord music bot with slash commands, YouTube search, queues, and a persistent 24/7 voice setting. Built with `discord.js`, `@discordjs/voice` (including Discord's DAVE encryption support), `yt-dlp` and FFmpeg.

## Features

- YouTube video search by title, or play a direct video link
- Separate queue per Discord server; play / skip / stop / pause / resume
- Volume (0–200%), song/queue repeat, shuffle, clear, remove, and now-playing
- `/stay on`: remembers the voice channel in `state/stay-channels.json` and rejoins after a bot restart
- 30-second watchdog for unexpected voice disconnections; never auto-leaves just because the queue is empty
- 24/7 does **not** mean playing music continuously: it means staying connected silently between songs
- No YouTube API key needed and no privileged message-content intent needed

## Requirements

- **Node.js 24.17 or newer** (https://nodejs.org/)
- **Python 3.11+** (if installing yt-dlp with pip), or a current standalone `yt-dlp` executable
- **FFmpeg** installed and accessible in your `PATH`
- The Discord application bot token; a computer or VPS kept running to be online 24/7
- On Linux with native Opus bindings, compiler/build tools may be needed (`build-essential`, `python3`, etc.).

Verify dependencies in a terminal:

```bash
node --version
ffmpeg -version
yt-dlp --version
```

## Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications), create an application and add a bot. Copy the **bot token** (keep it private).
2. In the Developer Portal, OAuth2 > URL Generator, choose scopes `bot` and `applications.commands`. Choose permissions **View Channels, Connect, Speak, Send Messages**. Open that generated invite link and add the bot to your server. Enable the permissions in the target voice/text channels too.
3. Download/extract this project, then open a terminal in its root folder.
4. Install dependencies:

   ```bash
   npm install
   python -m pip install -U "yt-dlp[default]"
   ```

   On Linux you might need `python3` instead of `python`.

5. Install FFmpeg, if you haven't yet:
   - **Windows**: `winget install Gyan.FFmpeg`, then reopen your terminal.
   - **Ubuntu/Debian**: `sudo apt update && sudo apt install -y ffmpeg`
   - **macOS**: `brew install ffmpeg`

6. Create your `.env` file from `.env.example` and paste the token. On Windows:

   ```powershell
   Copy-Item .env.example .env
   ```

   On Linux/macOS:

   ```bash
   cp .env.example .env
   ```

   Set `GUILD_ID` to your test server ID to register commands quickly in that server, or leave it blank to register globally. The token stays in `.env`; **never upload or share that file**.

7. Start the bot:

   ```bash
   npm start
   ```

## Discord slash commands

| Command | Purpose |
|---|---|
| `/play query: ...` | YouTube search or direct video URL (adds to queue) |
| `/join` | Join your current voice channel |
| `/leave` | Disconnect and clear queue; disables 24/7 |
| `/skip` | Skip currently playing song |
| `/pause`, `/resume` | Pause or resume |
| `/stop` | Stop music and empty the queue, but stay connected |
| `/queue` | List currently playing and next 10 queued songs |
| `/nowplaying` | Show the current song |
| `/volume percent: 70` | Adjust playback volume |
| `/loop mode: ...` | Off, current song, or full queue |
| `/shuffle` | Shuffle upcoming songs |
| `/remove position: 1` | Remove one queued song |
| `/clear` | Empty upcoming queue |
| `/stay mode: on` | Enable 24/7 voice connection (requires **Manage Server**) |
| `/stay mode: off` | Disable 24/7 but stay in the channel (requires **Manage Server**) |
| `/stay mode: status` | See which voice channel is configured for 24/7 |

When playing music, join the **same voice room as the bot**. The bot can only join a normal voice channel (not a Stage channel). A user with Manage Server permission can move a bot already in a different room using `/join`.

## Keeping the bot up 24/7

**To stay in the voice channel**: join the target voice room, use `/join`, then run `/stay mode: on` (needs Manage Server permission). The bot will reconnect on restarts and after network drops, when possible.

**To keep the program running**: host it on an always-on machine or VPS. For Linux, an example `systemd` service is included at `deploy/music-bot.service`. Edit the username and paths, then:

```bash
sudo cp deploy/music-bot.service /etc/systemd/system/music-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now music-bot
sudo systemctl status music-bot
journalctl -u music-bot -f
```

Stop the service before editing `.env`, and restart after changes: `sudo systemctl restart music-bot`. On Windows, use a reliable process manager or an always-on Windows service host. If your PC sleeps, shuts down, or loses Internet, the bot cannot stay online; a service manager restarts the process but cannot prevent Discord or YouTube outages.

## YouTube availability / troubleshooting

- **YouTube audio may fail intermittently**: YouTube can change playback methods, enforce Proof of Origin tokens, restrict datacenter IP addresses or rate-limit requests. This package cannot guarantee uninterrupted YouTube audio; the 24/7 voice connection remains separate from song playback.
- Update `yt-dlp`: `python -m pip install -U "yt-dlp[default]"`. Try `yt-dlp -f bestaudio -o - "https://www.youtube.com/watch?v=..."` to diagnose a stream (this writes media to stdout, so avoid printing it to a terminal).
- If `ffmpeg` or `yt-dlp` cannot be found, ensure they are on the `PATH` of the account running the bot. Restart the process after installing them.
- New yt-dlp versions may require a supported JavaScript runtime (Deno is a supported option) to solve YouTube playback challenges.
- If `/play` fails in a server but works locally, YouTube may be blocking that server's IP; consult yt-dlp's official documentation rather than assuming a code bug.
- Make sure the bot has **Connect** and **Speak**, is not server-muted, and is not blocked by channel permission overrides.
- If slash commands aren't visible, confirm the `applications.commands` scope and that the commands registered. For testing, set `GUILD_ID` and restart.

## Notes and limitations

- This uses individual YouTube videos. **YouTube playlists are not imported** (you can add songs individually).
- The **24/7 channel setting** persists across restarts, but the in-memory song queue does not.
- Only play audio you have permission to use and follow YouTube and Discord's applicable terms.
- For security: only YouTube video URLs are accepted, and bot tokens stay in local environment variables.

## Development checks

```bash
npm run check
npm test
```

The tests validate URL handling and persistent state. Actual Discord voice, YouTube availability and bot permissions must be verified using your own bot token and server.
