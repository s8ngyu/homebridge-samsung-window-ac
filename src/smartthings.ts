import { createHash } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { SamsungConfig } from './config.js';

export interface CapabilityStatus {
  [attribute: string]: { value?: unknown; unit?: string } | undefined;
}

export interface DeviceStatus {
  components?: Record<string, Record<string, CapabilityStatus>>;
}

export interface DeviceDescription {
  deviceId: string;
  label?: string;
  name?: string;
  manufacturerName?: string;
  deviceModel?: string;
  components?: Array<{ id: string; capabilities?: Array<{ id: string }> }>;
}

interface Tokens {
  fingerprint: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export class SmartThingsError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

export class SmartThingsClient {
  private tokens?: Tokens;
  private refreshInFlight?: Promise<void>;
  private readonly fingerprint: string;

  constructor(private readonly config: SamsungConfig, private readonly tokenPath: string) {
    this.fingerprint = createHash('sha256')
      .update(`${config.clientId}\0${config.clientSecret}\0${config.refreshToken}`)
      .digest('hex');
  }

  async initialize(): Promise<void> {
    if (this.config.authMode === 'pat') {
      if (!this.config.personalAccessToken) {
        throw new SmartThingsError('Set a SmartThings personal access token in the plugin settings.');
      }
      return;
    }
    if (!this.config.clientId || !this.config.clientSecret || !this.config.refreshToken) {
      throw new SmartThingsError('Set SmartThings OAuth client ID, client secret, and refresh token in the plugin settings.');
    }
    try {
      const saved = JSON.parse(await readFile(this.tokenPath, 'utf8')) as Tokens;
      if (saved.fingerprint === this.fingerprint && saved.refreshToken && saved.accessToken) {
        this.tokens = { ...saved, expiresAt: Number.isFinite(saved.expiresAt) ? saved.expiresAt : 0 };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new SmartThingsError('Cannot read the SmartThings token store.');
      }
    }
  }

  private async saveTokens(tokens: Tokens): Promise<void> {
    await mkdir(dirname(this.tokenPath), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.tokenPath), 0o700);
    const temporary = `${this.tokenPath}.${process.pid}.tmp`;
    const handle = await open(temporary, 'w', 0o600);
    try {
      await handle.chmod(0o600);
      await handle.writeFile(JSON.stringify(tokens));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, this.tokenPath);
    const directory = await open(dirname(this.tokenPath), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }

  private async refresh(): Promise<void> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    this.refreshInFlight = (async () => {
      const currentRefreshToken = this.tokens?.refreshToken || this.config.refreshToken;
      const form = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: currentRefreshToken,
        client_id: this.config.clientId,
      });
      const authorization = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
      const response = await this.fetchWithTimeout('https://api.smartthings.com/oauth/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authorization}`,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });
      if (!response.ok) {
        throw new SmartThingsError(
          response.status === 400 ? 'SmartThings rejected the OAuth refresh token; reauthorize the app.' :
            `SmartThings token refresh failed (HTTP ${response.status}).`, response.status,
        );
      }
      const body = await response.json() as Record<string, unknown>;
      if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
        throw new SmartThingsError('SmartThings token response is missing a token.');
      }
      const tokens: Tokens = {
        fingerprint: this.fingerprint,
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresAt: Date.now() + Math.max(60, Number(body.expires_in) || 86400) * 1000,
      };
      // A refresh token is single use. Persist the replacement before any device call.
      await this.saveTokens(tokens);
      this.tokens = tokens;
    })();
    try {
      await this.refreshInFlight;
    } finally {
      this.refreshInFlight = undefined;
    }
  }

  private async token(): Promise<string> {
    if (this.config.authMode === 'pat') {
      return this.config.personalAccessToken;
    }
    if (!this.tokens || this.tokens.expiresAt < Date.now() + 5 * 60_000) {
      await this.refresh();
    }
    return this.tokens!.accessToken;
  }

  async maintainTokens(): Promise<void> {
    if (this.config.authMode === 'oauth') {
      await this.token();
    }
  }

  private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeout * 1000);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      throw new SmartThingsError(`SmartThings request failed: ${(error as Error).name === 'AbortError' ? 'timed out' : 'network error'}.`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    const accessToken = await this.token();
    const response = await this.fetchWithTimeout(`https://api.smartthings.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 401 && retry && this.config.authMode === 'oauth') {
      if (this.tokens?.accessToken === accessToken) {
        await this.refresh();
      }
      return this.request<T>(method, path, body, false);
    }
    if (!response.ok) {
      throw new SmartThingsError(`SmartThings ${method} ${path} failed (HTTP ${response.status}).`, response.status);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return response.json() as Promise<T>;
  }

  async findDevice(): Promise<DeviceDescription> {
    if (this.config.deviceId) {
      return this.request<DeviceDescription>('GET', `/devices/${encodeURIComponent(this.config.deviceId)}`);
    }
    const list = await this.request<{ items?: DeviceDescription[] }>('GET', '/devices');
    const candidates = (list.items || []).filter(device =>
      device.components?.some(component => component.capabilities?.some(capability =>
        ['airConditionerMode', 'thermostatCoolingSetpoint'].includes(capability.id))) ||
      /air conditioner|에어컨/i.test(`${device.label || ''} ${device.name || ''}`));
    if (candidates.length !== 1) {
      throw new SmartThingsError(`Found ${candidates.length} possible air conditioners. Set the SmartThings device ID in plugin settings.`);
    }
    return candidates[0];
  }

  status(deviceId: string): Promise<DeviceStatus> {
    return this.request<DeviceStatus>('GET', `/devices/${encodeURIComponent(deviceId)}/status`);
  }

  async command(deviceId: string, component: string, capability: string, command: string, args: unknown[] = []): Promise<void> {
    const result = await this.request<{ results?: Array<{ status?: string }> }>(
      'POST', `/devices/${encodeURIComponent(deviceId)}/commands`, {
        commands: [{ component, capability, command, arguments: args }],
      });
    if (!Array.isArray(result?.results) || result.results.length === 0 ||
        result.results.some(item => !['ACCEPTED', 'COMPLETED'].includes(item.status || ''))) {
      throw new SmartThingsError(`SmartThings rejected ${capability}.${command}.`);
    }
  }
}
