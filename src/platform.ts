import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { SamsungWindowACAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import axios from 'axios';

interface SmartThingsDevice {
  deviceId: string;
  name: string;
  label: string;
}

interface SmartThingsDevicesResponse {
  items: SmartThingsDevice[];
}

interface TemperatureResponse {
  temperature: {
    value: number;
    unit: string;
    timestamp: string;
  };
}

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class SamsungWindowACPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];

  private apiToken: string;
  private deviceId: string | null = null;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.apiToken = config.apiToken;

    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * This method discovers Samsung Window AC devices.
   * In a real implementation, you would discover devices from the local network or cloud services.
   */
  async discoverDevices() {
    // Get device ID from SmartThings API
    this.deviceId = await this.getDeviceId();
    
    if (!this.deviceId) {
      this.log.error('Failed to get Samsung Window A/C device ID. Cannot register accessory.');
      return;
    }

    // Create Samsung AC device object
    const samsungACDevice = {
      uniqueId: this.deviceId,
      displayName: 'Samsung Window A/C',
      model: 'Samsung WindFree',
      serialNumber: this.deviceId,
    };

    // generate a unique id for the accessory
    const uuid = this.api.hap.uuid.generate(samsungACDevice.uniqueId);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.get(uuid);

    if (existingAccessory) {
      // the accessory already exists
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

      // create the accessory handler for the restored accessory
      new SamsungWindowACAccessory(this, existingAccessory);
    } else {
      // the accessory does not yet exist, so we need to create it
      this.log.info('Adding new accessory:', samsungACDevice.displayName);

      // create a new accessory
      const accessory = new this.api.platformAccessory(samsungACDevice.displayName, uuid);

      // store a copy of the device object in the `accessory.context`
      accessory.context.device = samsungACDevice;

      // create the accessory handler for the newly create accessory
      new SamsungWindowACAccessory(this, accessory);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    // push into discoveredCacheUUIDs
    this.discoveredCacheUUIDs.push(uuid);

    // you can also deal with accessories from the cache which are no longer present by removing them from Homebridge
    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }

  /**
   * Get device ID from SmartThings API
   */
  private async getDeviceId(): Promise<string | null> {
    try {
      const response = await axios.get<SmartThingsDevicesResponse>('https://api.smartthings.com/v1/devices', {
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json'
        }
      });

      const samsungACDevice = response.data.items.find((device: SmartThingsDevice) => 
        device.name === 'Samsung Window A/C' || device.label === 'Samsung Window A/C'
      );

      if (samsungACDevice) {
        this.log.info(`Found Samsung Window A/C device: ${samsungACDevice.deviceId}`);
        return samsungACDevice.deviceId;
      } else {
        this.log.error('Samsung Window A/C device not found in SmartThings devices');
        return null;
      }
    } catch (error) {
      this.log.error('Failed to get devices from SmartThings API:', error);
      return null;
    }
  }

  /**
   * Get current temperature from SmartThings API
   */
  public async getCurrentTemperature(): Promise<number | null> {
    if (!this.deviceId) {
      this.log.error('Device ID not available');
      return null;
    }

    try {
      const response = await axios.get<TemperatureResponse>(
        `https://api.smartthings.com/v1/devices/${this.deviceId}/components/main/capabilities/temperatureMeasurement/status`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const temperature = response.data.temperature.value;
      this.log.debug(`Current temperature from SmartThings: ${temperature}°C`);
      return temperature;
    } catch (error) {
      this.log.error('Failed to get temperature from SmartThings API:', error);
      return null;
    }
  }
}
