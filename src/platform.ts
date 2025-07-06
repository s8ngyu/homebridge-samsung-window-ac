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

interface HumidityResponse {
  humidity: {
    value: number;
    unit: string;
    timestamp: string;
  };
}

interface AirConditionerModeResponse {
  availableAcModes: {
    value: string[];
    timestamp: string;
  };
  supportedAcModes: {
    value: string[];
    timestamp: string;
  };
  airConditionerMode: {
    value: string;
    timestamp: string;
  };
}

interface CommandResponse {
  results: Array<{
    id: string;
    status: string;
  }>;
}

interface SwitchResponse {
  switch: {
    value: string;
    timestamp: string;
  };
}

interface ThermostatCoolingSetpointResponse {
  coolingSetpointRange: {
    value: {
      minimum: number;
      maximum: number;
      step: number;
    };
    unit: string;
    timestamp: string;
  };
  coolingSetpoint: {
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

  // Cache for API responses to avoid too many requests
  private cache = {
    temperature: { value: null as number | null, timestamp: 0 },
    humidity: { value: null as number | null, timestamp: 0 },
  };
  
  // Cache duration in milliseconds (5 minutes)
  private readonly CACHE_DURATION = 5 * 60 * 1000;

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
    const deviceInfo = await this.getDeviceId();
    
    if (!deviceInfo) {
      this.log.error('Failed to get Samsung Window A/C device ID. Cannot register accessory.');
      return;
    }

    this.deviceId = deviceInfo.deviceId;

    // Create Samsung AC device object
    const samsungACDevice = {
      uniqueId: deviceInfo.deviceId,
      displayName: deviceInfo.deviceInfo.label || 'Samsung Window A/C',
      model: 'Samsung WindFree',
      serialNumber: deviceInfo.deviceId,
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
  private async getDeviceId(): Promise<{ deviceId: string; deviceInfo: SmartThingsDevice } | null> {
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
        this.log.info(`Found Samsung Window A/C device: ${samsungACDevice.deviceId} (${samsungACDevice.label})`);
        return { deviceId: samsungACDevice.deviceId, deviceInfo: samsungACDevice };
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

    // Check cache first
    if (this.cache.temperature.value !== null && this.isCacheValid(this.cache.temperature.timestamp)) {
      this.log.debug(`Using cached temperature: ${this.cache.temperature.value}°C`);
      return this.cache.temperature.value;
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
      this.updateCache('temperature', temperature);
      this.log.debug(`Current temperature from SmartThings: ${temperature}°C`);
      return temperature;
    } catch (error) {
      this.log.error('Failed to get temperature from SmartThings API:', error);
      // Return cached value if available, even if expired
      if (this.cache.temperature.value !== null) {
        this.log.debug(`Using expired cached temperature: ${this.cache.temperature.value}°C`);
        return this.cache.temperature.value;
      }
      return null;
    }
  }

  /**
   * Get current humidity from SmartThings API
   */
  public async getCurrentHumidity(): Promise<number | null> {
    if (!this.deviceId) {
      this.log.error('Device ID not available');
      return null;
    }

    // Check cache first
    if (this.cache.humidity.value !== null && this.isCacheValid(this.cache.humidity.timestamp)) {
      this.log.debug(`Using cached humidity: ${this.cache.humidity.value}%`);
      return this.cache.humidity.value;
    }

    try {
      const response = await axios.get<HumidityResponse>(
        `https://api.smartthings.com/v1/devices/${this.deviceId}/components/main/capabilities/relativeHumidityMeasurement/status`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const humidity = response.data.humidity.value;
      this.updateCache('humidity', humidity);
      this.log.debug(`Current humidity from SmartThings: ${humidity}%`);
      return humidity;
    } catch (error) {
      this.log.error('Failed to get humidity from SmartThings API:', error);
      // Return cached value if available, even if expired
      if (this.cache.humidity.value !== null) {
        this.log.debug(`Using expired cached humidity: ${this.cache.humidity.value}%`);
        return this.cache.humidity.value;
      }
      return null;
    }
  }

  /**
   * Get current air conditioner mode from SmartThings API
   */
  public async getCurrentACMode(): Promise<string | null> {
    if (!this.deviceId) {
      this.log.error('Device ID not available');
      return null;
    }

    // First check if AC is turned on
    const switchStatus = await this.getSwitchStatus();
    if (switchStatus === 'off') {
      this.log.debug('AC is turned off, returning off mode');
      return 'off';
    }

    try {
      const response = await axios.get<AirConditionerModeResponse>(
        `https://api.smartthings.com/v1/devices/${this.deviceId}/components/main/capabilities/airConditionerMode/status`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const mode = response.data.airConditionerMode.value;
      this.log.debug(`Current AC mode from SmartThings: ${mode}`);
      return mode;
    } catch (error) {
      this.log.error('Failed to get AC mode from SmartThings API:', error);
      return null;
    }
  }

  /**
   * Get current switch status from SmartThings API
   */
  public async getSwitchStatus(): Promise<string | null> {
    if (!this.deviceId) {
      this.log.error('Device ID not available');
      return null;
    }

    try {
      const response = await axios.get<SwitchResponse>(
        `https://api.smartthings.com/v1/devices/${this.deviceId}/components/main/capabilities/switch/status`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const switchStatus = response.data.switch.value;
      this.log.debug(`Current switch status from SmartThings: ${switchStatus}`);
      return switchStatus;
    } catch (error) {
      this.log.error('Failed to get switch status from SmartThings API:', error);
      return null;
    }
  }

  /**
   * Get target temperature from SmartThings API
   */
  public async getTargetTemperature(): Promise<number | null> {
    if (!this.deviceId) {
      this.log.error('Device ID not available');
      return null;
    }

    try {
      const response = await axios.get<ThermostatCoolingSetpointResponse>(
        `https://api.smartthings.com/v1/devices/${this.deviceId}/components/main/capabilities/thermostatCoolingSetpoint/status`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const targetTemperature = response.data.coolingSetpoint.value;
      this.log.debug(`Target temperature from SmartThings: ${targetTemperature}°C`);
      return targetTemperature;
    } catch (error) {
      this.log.error('Failed to get target temperature from SmartThings API:', error);
      return null;
    }
  }

  /**
   * Set target temperature via SmartThings API
   */
  public async setTargetTemperature(temperature: number): Promise<boolean> {
    if (!this.deviceId) {
      this.log.error('Device ID not available');
      return false;
    }

    try {
      const response = await axios.post<CommandResponse>(
        `https://api.smartthings.com/v1/devices/${this.deviceId}/commands`,
        {
          commands: [
            {
              capability: 'thermostatCoolingSetpoint',
              command: 'setCoolingSetpoint',
              arguments: [temperature]
            }
          ]
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const result = response.data.results[0];
      if (result.status === 'COMPLETED') {
        this.log.info(`Successfully set target temperature to: ${temperature}°C`);
        // Invalidate temperature cache when target temperature changes
        this.invalidateCache('temperature');
        return true;
      } else {
        this.log.error(`Failed to set target temperature to ${temperature}°C. Status: ${result.status}`);
        return false;
      }
    } catch (error) {
      this.log.error(`Failed to set target temperature to ${temperature}°C:`, error);
      return false;
    }
  }

  /**
   * Set air conditioner mode via SmartThings API
   */
  public async setACMode(mode: string): Promise<boolean> {
    if (!this.deviceId) {
      this.log.error('Device ID not available');
      return false;
    }

    try {
      const response = await axios.post<CommandResponse>(
        `https://api.smartthings.com/v1/devices/${this.deviceId}/commands`,
        {
          commands: [
            {
              capability: 'airConditionerMode',
              command: 'setAirConditionerMode',
              arguments: [mode]
            }
          ]
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const result = response.data.results[0];
      if (result.status === 'COMPLETED') {
        this.log.info(`Successfully set AC mode to: ${mode}`);
        // Invalidate temperature and humidity cache when mode changes
        this.invalidateCache('temperature');
        this.invalidateCache('humidity');
        return true;
      } else {
        this.log.error(`Failed to set AC mode to ${mode}. Status: ${result.status}`);
        return false;
      }
    } catch (error) {
      this.log.error(`Failed to set AC mode to ${mode}:`, error);
      return false;
    }
  }

  /**
   * Turn off air conditioner via SmartThings API
   */
  public async turnOffAC(): Promise<boolean> {
    if (!this.deviceId) {
      this.log.error('Device ID not available');
      return false;
    }

    try {
      const response = await axios.post<CommandResponse>(
        `https://api.smartthings.com/v1/devices/${this.deviceId}/commands`,
        {
          commands: [
            {
              capability: 'switch',
              command: 'off'
            }
          ]
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const result = response.data.results[0];
      if (result.status === 'COMPLETED') {
        this.log.info('Successfully turned off AC');
        // Invalidate temperature and humidity cache when AC is turned off
        this.invalidateCache('temperature');
        this.invalidateCache('humidity');
        return true;
      } else {
        this.log.error(`Failed to turn off AC. Status: ${result.status}`);
        return false;
      }
    } catch (error) {
      this.log.error('Failed to turn off AC:', error);
      return false;
    }
  }

  /**
   * Check if cache is valid
   */
  private isCacheValid(timestamp: number): boolean {
    return Date.now() - timestamp < this.CACHE_DURATION;
  }

  /**
   * Update cache with new value
   */
  private updateCache(type: keyof typeof this.cache, value: any): void {
    this.cache[type] = { value, timestamp: Date.now() };
  }

  /**
   * Invalidate cache for a specific type or all
   */
  public invalidateCache(type?: keyof typeof this.cache): void {
    if (type) {
      this.cache[type] = { value: null, timestamp: 0 };
      this.log.debug(`Invalidated cache for ${type}`);
    } else {
      this.cache = {
        temperature: { value: null, timestamp: 0 },
        humidity: { value: null, timestamp: 0 },
      };
      this.log.debug('Invalidated all cache');
    }
  }
}
