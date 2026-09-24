import { join } from 'node:path';

import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { parseConfig, type SamsungConfig } from './config.js';
import { SamsungWindowACAccessory } from './platformAccessory.js';
import { SmartThingsClient, type DeviceDescription } from './smartthings.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

export class SamsungWindowACPlatform implements DynamicPlatformPlugin {
  readonly Service: typeof Service;
  readonly Characteristic: typeof Characteristic;
  readonly settings: SamsungConfig;
  readonly client: SmartThingsClient;
  private readonly cached = new Map<string, PlatformAccessory>();
  private tokenMaintenanceStarted = false;

  constructor(
    readonly log: Logging,
    rawConfig: PlatformConfig,
    readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.settings = parseConfig(rawConfig);
    this.client = new SmartThingsClient(this.settings, join(api.user.storagePath(), 'samsung-window-ac', 'tokens-v2.json'));
    api.on('didFinishLaunching', () => void this.launch());
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.cached.set(accessory.UUID, accessory);
  }

  private async launch(): Promise<void> {
    let device: DeviceDescription | undefined;
    try {
      await this.client.initialize();
      this.startTokenMaintenance();
      device = await this.client.findDevice();
    } catch (error) {
      this.log.warn(`Samsung Window AC discovery: ${(error as Error).message}`);
    }

    // Keep the old device-ID UUID so existing HomeKit accessories and automations survive.
    const deviceId = device?.deviceId || this.settings.deviceId;
    const uuid = deviceId ? this.api.hap.uuid.generate(deviceId) : undefined;
    let accessory = uuid ? this.cached.get(uuid) : undefined;
    if (!accessory && !uuid && this.cached.size === 1) {
      accessory = [...this.cached.values()][0];
    }
    if (!accessory && uuid) {
      accessory = new this.api.platformAccessory(this.settings.name, uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
    if (!accessory) {
      this.log.error('Set a SmartThings device ID in settings to keep the accessory available when discovery is offline.');
      return;
    }
    accessory.context.device = {
      uniqueId: deviceId || accessory.UUID,
      displayName: this.settings.name,
      model: device?.deviceModel || 'Samsung Window A/C',
      serialNumber: deviceId || this.settings.deviceIp,
    };
    for (const [cachedUuid, stale] of this.cached) {
      if (stale !== accessory && deviceId && cachedUuid !== uuid) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [stale]);
      }
    }
    new SamsungWindowACAccessory(this, accessory, device);
    this.api.updatePlatformAccessories([accessory]);
  }

  private startTokenMaintenance(): void {
    if (this.tokenMaintenanceStarted || this.settings.authMode !== 'oauth') {
      return;
    }
    this.tokenMaintenanceStarted = true;
    const timer = setInterval(() => {
      void this.client.maintainTokens().catch(error =>
        this.log.warn(`Samsung Window AC token renewal: ${(error as Error).message}`));
    }, 6 * 60 * 60 * 1000);
    timer.unref();
  }
}
