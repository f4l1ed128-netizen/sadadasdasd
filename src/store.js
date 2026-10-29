import fs from 'node:fs';
import path from 'node:path';

/** Persist the voice channel per server so bot joins it after a restart. */
export class StayStore {
  constructor(file) {
    this.file = file;
    this.channels = {};
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        this.channels = Object.fromEntries(Object.entries(data).filter(([k, v]) => /^\d+$/.test(k) && /^\d+$/.test(v)));
      }
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn('Could not load 24/7 state:', e.message);
    }
  }

  get(guildId) { return this.channels[guildId] || null; }
  entries() { return Object.entries(this.channels); }

  set(guildId, channelId) {
    this.channels[guildId] = channelId;
    this.save();
  }

  delete(guildId) {
    delete this.channels[guildId];
    this.save();
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.channels, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
}
