'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const MACHINE_KEY_BYTES = 32;
const SESSION_FILE = 'qishui-session.enc';
const KEY_FILE = 'session-key';

function defaultDataDirectory() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'SonicUniverse');
}

async function ensurePrivateDirectory(directory) {
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
}

async function atomicWrite(filename, data) {
  await ensurePrivateDirectory(path.dirname(filename));
  const temporary = `${filename}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  await fsp.writeFile(temporary, data, { mode: 0o600 });
  await fsp.rename(temporary, filename);
}

async function loadOrCreateMachineKey(directory) {
  const filename = path.join(directory, KEY_FILE);
  try {
    const key = await fsp.readFile(filename);
    if (key.length === MACHINE_KEY_BYTES) return key;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const key = crypto.randomBytes(MACHINE_KEY_BYTES);
  await atomicWrite(filename, key);
  return key;
}

function encryptJson(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  return Buffer.concat([Buffer.from('SU1'), iv, cipher.getAuthTag(), encrypted]);
}

function decryptJson(buffer, key) {
  if (buffer.length < 31 || buffer.subarray(0, 3).toString() !== 'SU1') throw new Error('Invalid encrypted session');
  const iv = buffer.subarray(3, 15);
  const tag = buffer.subarray(15, 31);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(buffer.subarray(31)), decipher.final()]).toString('utf8'));
}

class EncryptedQishuiSessionStore {
  constructor(options = {}) {
    this.directory = options.directory || defaultDataDirectory();
    this.sessionFile = path.join(this.directory, SESSION_FILE);
    this.device = null;
    this.current = null;
    this.revision = 0;
    this.key = null;
    this.writeChain = Promise.resolve();
    this.onError = typeof options.onError === 'function' ? options.onError : () => {};
  }

  async init(createDeviceId) {
    await ensurePrivateDirectory(this.directory);
    this.key = await loadOrCreateMachineKey(this.directory);
    try {
      const saved = decryptJson(await fsp.readFile(this.sessionFile), this.key);
      if (saved && typeof saved.deviceId === 'string' && typeof saved.session === 'object' && saved.session) {
        this.device = saved.deviceId;
        this.current = saved.session;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.current = null;
        this.onError('Stored Qishui session could not be decrypted and was ignored');
      }
    }
    if (!this.device) this.device = createDeviceId();
    await this.flush();
    return this;
  }

  get deviceId() {
    return this.device;
  }

  get() {
    return this.current;
  }

  set(value) {
    this.current = value;
    this.revision += 1;
    this.flush().catch(this.onError);
  }

  clear() {
    this.current = null;
    this.revision += 1;
    this.flush().catch(this.onError);
  }

  flush() {
    const write = async () => {
      if (!this.key || !this.device) return;
      const payload = { version: 1, deviceId: this.device, session: this.current };
      await atomicWrite(this.sessionFile, encryptJson(payload, this.key));
    };
    this.writeChain = this.writeChain.then(write, write);
    return this.writeChain;
  }
}

module.exports = {
  EncryptedQishuiSessionStore,
  encryptJson,
  decryptJson,
  defaultDataDirectory,
};
