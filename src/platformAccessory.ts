import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { SamsungWindowACPlatform } from './platform.js';

// Device status response type
interface DeviceStatusResponse {
  components: {
    main: {
      switch: {
        switch: {
          value: string;
          timestamp: string;
        };
      };
      temperatureMeasurement: {
        temperature: {
          value: number;
          unit: string;
          timestamp: string;
        };
      };
      relativeHumidityMeasurement: {
        humidity: {
          value: number;
          unit: string;
          timestamp: string;
        };
      };
      airConditionerMode: {
        airConditionerMode: {
          value: string;
          timestamp: string;
        };
      };
      thermostatCoolingSetpoint: {
        coolingSetpoint: {
          value: number;
          unit: string;
          timestamp: string;
        };
      };
    };
  };
}

// AC Mode mapping constants
const AC_MODE_MAPPING = {
  // Samsung AC modes to HomeKit modes
  'off': 0,      // Off
  'cool': 2,     // Cool
  'dry': 1,      // Heat (mapped to Dry)
  'aIComfort': 3, // Auto (mapped to AI Comfort)
  'fan': 0,      // Fan mode ignored, mapped to Off
} as const;

const HOMEKIT_MODE_MAPPING = {
  // HomeKit modes to Samsung AC modes
  0: 'off',      // Off
  1: 'dry',      // Heat -> Dry
  2: 'cool',     // Cool
  3: 'aIComfort', // Auto -> AI Comfort
} as const;

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SamsungWindowACAccessory {
  private service: Service;
  private humidityService: Service;

  /**
   * These are used to track the state of the air conditioner
   */
  private acStates = {
    Active: false,
    CurrentHeatingCoolingState: 0, // 0: Off, 1: Heat, 2: Cool
    TargetHeatingCoolingState: 0, // 0: Off, 1: Heat, 2: Cool, 3: Auto
    CurrentTemperature: 24,
    TargetTemperature: 24,
    CoolingThresholdTemperature: 24,
    HeatingThresholdTemperature: 24,
    CurrentHumidity: 50,
    TemperatureDisplayUnits: 0, // 0: Celsius, 1: Fahrenheit
  };

  /**
   * Cache for device status to reduce API calls
   */
  private statusCache: {
    data: DeviceStatusResponse | null;
    timestamp: number;
  } | null = null;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

  /**
   * Individual characteristic caches to avoid unnecessary API calls
   */
  private characteristicCaches: {
    [key: string]: {
      value: boolean | number;
      timestamp: number;
    };
  } = {};
  private readonly CHARACTERISTIC_CACHE_DURATION = 30 * 1000; // 30 seconds for individual characteristics

  /**
   * Convert Samsung AC mode to HomeKit mode
   */
  private samsungModeToHomeKit(samsungMode: string): number {
    return AC_MODE_MAPPING[samsungMode as keyof typeof AC_MODE_MAPPING] ?? 0;
  }

  /**
   * Convert HomeKit mode to Samsung AC mode
   */
  private homeKitModeToSamsung(homeKitMode: number): string {
    return HOMEKIT_MODE_MAPPING[homeKitMode as keyof typeof HOMEKIT_MODE_MAPPING] ?? 'off';
  }

  /**
   * Clear all characteristic caches when device state changes
   */
  private clearCharacteristicCaches(): void {
    this.characteristicCaches = {};
    this.platform.log.debug('Cleared all characteristic caches due to state change');
  }

  /**
   * Update specific characteristic cache with new value
   */
  private updateCharacteristicCache(key: string, value: boolean | number): void {
    this.characteristicCaches[key] = {
      value,
      timestamp: Date.now(),
    };
    this.platform.log.debug(`Updated cache for ${key} -> ${value}`);
  }

  /**
   * Get device status with caching
   */
  private async getDeviceStatus(): Promise<DeviceStatusResponse | null> {
    const now = Date.now();
    
    // Check if cache is valid
    if (this.statusCache && (now - this.statusCache.timestamp) < this.CACHE_DURATION) {
      this.platform.log.debug('Using cached device status');
      return this.statusCache.data;
    }

    // Get fresh data from API
    this.platform.log.debug('Device status retrieved from SmartThings API');
    const status = await this.platform.getDeviceStatus();
    if (status) {
      this.statusCache = {
        data: status,
        timestamp: now,
      };
      this.platform.log.debug('Updated device status cache');
    }
    
    return status;
  }

  constructor(
    private readonly platform: SamsungWindowACPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.serialNumber);

    // get the Thermostat service if it exists, otherwise create a new Thermostat service
    this.service = this.accessory.getService(this.platform.Service.Thermostat) || 
      this.accessory.addService(this.platform.Service.Thermostat);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.displayName);

    // Set initial temperature values and ranges
    this.service.setCharacteristic(this.platform.Characteristic.TargetTemperature, 24);
    this.service.setCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, 24);
    this.service.setCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, 24);
    this.service.setCharacteristic(this.platform.Characteristic.CurrentTemperature, 24);
    
    // Set temperature display units to Celsius
    this.service.setCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, 0);
    
    // Set initial heating/cooling states
    this.service.setCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, 0);
    this.service.setCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState, 0);
    
    // Set initial active state
    this.service.setCharacteristic(this.platform.Characteristic.Active, false);

    // Create humidity service
    this.humidityService = this.accessory.getService(this.platform.Service.HumiditySensor) || 
      this.accessory.addService(this.platform.Service.HumiditySensor);
    
    // Set humidity service name
    this.humidityService.setCharacteristic(this.platform.Characteristic.Name, `${accessory.context.device.displayName} Humidity`);
    
    // Set initial humidity value
    this.humidityService.setCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, 50);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Thermostat

    // register handlers for the Active Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .onGet(this.getActive.bind(this));

    // register handlers for the CurrentHeatingCoolingState Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.getCurrentHeatingCoolingState.bind(this));

    // register handlers for the TargetHeatingCoolingState Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onSet(this.setTargetHeatingCoolingState.bind(this))
      .onGet(this.getTargetHeatingCoolingState.bind(this));

    // register handlers for the CurrentTemperature Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    // register handlers for the TargetTemperature Characteristic
    const targetTempChar = this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature);
    targetTempChar
      .setProps({
        minValue: 18,
        maxValue: 30,
        minStep: 1,
      })
      .onSet(this.setTargetTemperature.bind(this))
      .onGet(this.getTargetTemperature.bind(this));

    // register handlers for the CoolingThresholdTemperature Characteristic
    const coolingThresholdChar = this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature);
    coolingThresholdChar
      .setProps({
        minValue: 18,
        maxValue: 30,
        minStep: 1,
      })
      .onSet(this.setCoolingThresholdTemperature.bind(this))
      .onGet(this.getCoolingThresholdTemperature.bind(this));

    // register handlers for the HeatingThresholdTemperature Characteristic
    const heatingThresholdChar = this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature);
    heatingThresholdChar
      .setProps({
        minValue: 18,
        maxValue: 30,
        minStep: 1,
      })
      .onSet(this.setHeatingThresholdTemperature.bind(this))
      .onGet(this.getHeatingThresholdTemperature.bind(this));

    // register handlers for the TemperatureDisplayUnits Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onSet(this.setTemperatureDisplayUnits.bind(this))
      .onGet(this.getTemperatureDisplayUnits.bind(this));

    // register handlers for the CurrentRelativeHumidity Characteristic
    this.humidityService.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(this.getCurrentHumidity.bind(this));
  }

  /**
   * Handle "SET" requests from HomeKit for Active
   */
  async setActive(value: CharacteristicValue) {
    const isActive = value as boolean;
    
    this.platform.log.debug(`Set Characteristic Active -> ${isActive}`);
    
    if (isActive) {
      // Turn on AC - set to current target mode
      const samsungMode = this.homeKitModeToSamsung(this.acStates.TargetHeatingCoolingState);
      const success = await this.platform.setACMode(samsungMode);
      
      if (success) {
        this.acStates.Active = true;
        this.acStates.CurrentHeatingCoolingState = this.acStates.TargetHeatingCoolingState;
        
        // Update caches with new values
        this.updateCharacteristicCache('Active', true);
        this.updateCharacteristicCache('CurrentHeatingCoolingState', this.acStates.CurrentHeatingCoolingState);
        this.updateCharacteristicCache('TargetHeatingCoolingState', this.acStates.TargetHeatingCoolingState);
        
        this.platform.log.info(`Successfully turned on AC with mode: ${samsungMode}`);
      } else {
        this.platform.log.error(`Failed to turn on AC with mode: ${samsungMode}`);
        // Don't update local state if API call failed
      }
    } else {
      // Turn off AC using switch capability
      const success = await this.platform.turnOffAC();
      
      if (success) {
        this.acStates.Active = false;
        this.acStates.CurrentHeatingCoolingState = 0;
        this.acStates.TargetHeatingCoolingState = 0;
        
        // Update caches with new values
        this.updateCharacteristicCache('Active', false);
        this.updateCharacteristicCache('CurrentHeatingCoolingState', 0);
        this.updateCharacteristicCache('TargetHeatingCoolingState', 0);
        
        this.platform.log.info('Successfully turned off AC');
      } else {
        this.platform.log.error('Failed to turn off AC');
        // Don't update local state if API call failed
      }
    }
  }

  /**
   * Handle "GET" requests from HomeKit for Active
   */
  async getActive(): Promise<CharacteristicValue> {
    const cacheKey = 'Active';
    const now = Date.now();
    
    // Check if we have a valid cache for this characteristic
    if (this.characteristicCaches[cacheKey] && 
        (now - this.characteristicCaches[cacheKey].timestamp) < this.CHARACTERISTIC_CACHE_DURATION) {
      const cachedValue = this.characteristicCaches[cacheKey].value;
      this.platform.log.debug(`Get Characteristic Active -> ${cachedValue} (cached)`);
      return cachedValue;
    }
    
    const status = await this.getDeviceStatus();
    if (status) {
      const isActive = status.components.main.switch.switch.value === 'on';
      this.acStates.Active = isActive;
      
      // Cache the result
      this.characteristicCaches[cacheKey] = {
        value: isActive,
        timestamp: now,
      };
      
      this.platform.log.debug(`Get Characteristic Active -> ${isActive}`);
      return isActive;
    }
    
    // Fallback to cached state if API fails
    this.platform.log.debug(`Get Characteristic Active -> ${this.acStates.Active} (fallback)`);
    return this.acStates.Active;
  }

  /**
   * Handle "GET" requests from HomeKit for CurrentHeatingCoolingState
   */
  async getCurrentHeatingCoolingState(): Promise<CharacteristicValue> {
    const cacheKey = 'CurrentHeatingCoolingState';
    const now = Date.now();
    
    // Check if we have a valid cache for this characteristic
    if (this.characteristicCaches[cacheKey] && 
        (now - this.characteristicCaches[cacheKey].timestamp) < this.CHARACTERISTIC_CACHE_DURATION) {
      const cachedValue = this.characteristicCaches[cacheKey].value;
      this.platform.log.debug(`Get Characteristic CurrentHeatingCoolingState -> ${cachedValue} (cached)`);
      return cachedValue;
    }
    
    const status = await this.getDeviceStatus();
    if (status) {
      const acMode = status.components.main.airConditionerMode.airConditionerMode.value;
      const isActive = status.components.main.switch.switch.value === 'on';
      
      let currentState: number;
      if (!isActive) {
        currentState = 0; // Off
      } else {
        const homeKitMode = this.samsungModeToHomeKit(acMode);
        // HomeKit CurrentHeatingCoolingState max value is 2, so convert Auto (3) to Cool (2)
        // But we'll use Cool (2) for Auto mode since it's the most appropriate representation
        if (homeKitMode === 3) {
          currentState = 2; // Auto -> Cool for current state
          this.platform.log.debug('Auto mode detected, showing as Cool (2) for CurrentHeatingCoolingState');
        } else {
          currentState = homeKitMode;
        }
      }
      
      this.acStates.CurrentHeatingCoolingState = currentState;
      
      // Cache the result
      this.characteristicCaches[cacheKey] = {
        value: currentState,
        timestamp: now,
      };
      
      this.platform.log.debug(`Get Characteristic CurrentHeatingCoolingState -> ${currentState} (from mode: ${acMode})`);
      return currentState;
    }
    
    // Fallback to cached state if API fails
    this.platform.log.debug(`Get Characteristic CurrentHeatingCoolingState -> ${this.acStates.CurrentHeatingCoolingState} (fallback)`);
    return this.acStates.CurrentHeatingCoolingState;
  }

  /**
   * Handle "SET" requests from HomeKit for TargetHeatingCoolingState
   */
  async setTargetHeatingCoolingState(value: CharacteristicValue) {
    const homeKitMode = value as number;
    const samsungMode = this.homeKitModeToSamsung(homeKitMode);
    
    this.platform.log.debug(`Set Characteristic TargetHeatingCoolingState (${homeKitMode} -> ${samsungMode})`);
    
    let success = false;
    
    if (homeKitMode === 0) {
      // Off mode - use switch off command
      success = await this.platform.turnOffAC();
    } else if (homeKitMode === 3) {
      // Auto mode (aIComfort) - use HeatingThresholdTemperature as target
      const targetTemp = this.acStates.HeatingThresholdTemperature;
      success = await this.platform.setACMode(samsungMode);
      if (success) {
        // Set target temperature to HeatingThresholdTemperature value
        await this.platform.setTargetTemperature(targetTemp);
        
        // Update CoolingThresholdTemperature for Auto mode
        const coolingThreshold = Math.min(targetTemp + 4, 30);
        this.acStates.CoolingThresholdTemperature = coolingThreshold;
        this.platform.log.debug(`Auto mode: Set CoolingThresholdTemperature to ${coolingThreshold}°C (HeatingThresholdTemperature + 4°C)`);
      }
    } else {
      // Other modes - use airConditionerMode command
      success = await this.platform.setACMode(samsungMode);
    }
    
    if (success) {
      this.acStates.TargetHeatingCoolingState = homeKitMode;
      
      if (this.acStates.Active) {
        // CurrentHeatingCoolingState cannot be Auto (3), so convert Auto to Cool (2)
        let currentState = homeKitMode;
        if (homeKitMode === 3) {
          currentState = 2; // Auto -> Cool for current state
          this.platform.log.debug('Auto mode set, CurrentHeatingCoolingState will show as Cool (2)');
        }
        this.acStates.CurrentHeatingCoolingState = currentState;
      }
      
      // Update caches with new values
      this.updateCharacteristicCache('TargetHeatingCoolingState', homeKitMode);
      this.updateCharacteristicCache('CurrentHeatingCoolingState', this.acStates.CurrentHeatingCoolingState);
      
      // For Auto mode, also update temperature caches
      if (homeKitMode === 3) {
        this.updateCharacteristicCache('HeatingThresholdTemperature', this.acStates.HeatingThresholdTemperature);
        this.updateCharacteristicCache('CoolingThresholdTemperature', this.acStates.CoolingThresholdTemperature);
        this.updateCharacteristicCache('TargetTemperature', this.acStates.TargetTemperature);
      }
      
      if (homeKitMode === 0) {
        this.acStates.Active = false;
        this.updateCharacteristicCache('Active', false);
        this.platform.log.info('Successfully turned off AC');
      } else if (homeKitMode === 3) {
        this.acStates.Active = true;
        this.updateCharacteristicCache('Active', true);
        this.platform.log.info(
          `Successfully changed AC mode to ${samsungMode} (HomeKit: ${homeKitMode}) with target temperature: ${this.acStates.HeatingThresholdTemperature}°C`,
        );
      } else {
        this.acStates.Active = true;
        this.updateCharacteristicCache('Active', true);
        this.platform.log.info(`Successfully changed AC mode to ${samsungMode} (HomeKit: ${homeKitMode})`);
      }
    } else {
      this.platform.log.error(`Failed to change AC mode to ${samsungMode} (HomeKit: ${homeKitMode})`);
      // Don't update local state if API call failed
    }
  }

  /**
   * Handle "GET" requests from HomeKit for TargetHeatingCoolingState
   */
  async getTargetHeatingCoolingState(): Promise<CharacteristicValue> {
    const cacheKey = 'TargetHeatingCoolingState';
    const now = Date.now();
    
    // Check if we have a valid cache for this characteristic
    if (this.characteristicCaches[cacheKey] && 
        (now - this.characteristicCaches[cacheKey].timestamp) < this.CHARACTERISTIC_CACHE_DURATION) {
      const cachedValue = this.characteristicCaches[cacheKey].value;
      this.platform.log.debug(`Get Characteristic TargetHeatingCoolingState -> ${cachedValue} (cached)`);
      return cachedValue;
    }
    
    const status = await this.getDeviceStatus();
    if (status) {
      const acMode = status.components.main.airConditionerMode.airConditionerMode.value;
      const homeKitMode = this.samsungModeToHomeKit(acMode);
      this.acStates.TargetHeatingCoolingState = homeKitMode;
      
      // Cache the result
      this.characteristicCaches[cacheKey] = {
        value: homeKitMode,
        timestamp: now,
      };
      
      this.platform.log.debug(`Get Characteristic TargetHeatingCoolingState -> ${homeKitMode} (from mode: ${acMode})`);
      return homeKitMode;
    }
    
    // Fallback to cached state if API fails
    this.platform.log.debug(`Get Characteristic TargetHeatingCoolingState -> ${this.acStates.TargetHeatingCoolingState} (fallback)`);
    return this.acStates.TargetHeatingCoolingState;
  }

  /**
   * Handle "GET" requests from HomeKit for CurrentTemperature
   */
  async getCurrentTemperature(): Promise<CharacteristicValue> {
    const cacheKey = 'CurrentTemperature';
    const now = Date.now();
    
    // Check if we have a valid cache for this characteristic
    if (this.characteristicCaches[cacheKey] && 
        (now - this.characteristicCaches[cacheKey].timestamp) < this.CHARACTERISTIC_CACHE_DURATION) {
      const cachedValue = this.characteristicCaches[cacheKey].value;
      this.platform.log.debug(`Get Characteristic CurrentTemperature -> ${cachedValue}°C (cached)`);
      return cachedValue;
    }
    
    const status = await this.getDeviceStatus();
    if (status) {
      const temperature = status.components.main.temperatureMeasurement.temperature.value;
      this.acStates.CurrentTemperature = temperature;
      
      // Cache the result
      this.characteristicCaches[cacheKey] = {
        value: temperature,
        timestamp: now,
      };
      
      this.platform.log.debug(`Get Characteristic CurrentTemperature -> ${temperature}°C`);
      return temperature;
    }
    
    // Fallback to cached state if API fails
    this.platform.log.debug(`Get Characteristic CurrentTemperature -> ${this.acStates.CurrentTemperature}°C (fallback)`);
    return this.acStates.CurrentTemperature;
  }

  /**
   * Handle "SET" requests from HomeKit for TargetTemperature
   */
  async setTargetTemperature(value: CharacteristicValue) {
    const temperature = value as number;
    
    this.platform.log.debug(`Set Characteristic TargetTemperature -> ${temperature}°C`);
    
    // Send command to SmartThings API to set target temperature
    const success = await this.platform.setTargetTemperature(temperature);
    
    if (success) {
      this.acStates.TargetTemperature = temperature;
      this.acStates.HeatingThresholdTemperature = temperature;
      this.acStates.CoolingThresholdTemperature = temperature;
      
      // Update caches with new values
      this.updateCharacteristicCache('TargetTemperature', temperature);
      this.updateCharacteristicCache('HeatingThresholdTemperature', temperature);
      
      // For Auto mode, set CoolingThresholdTemperature to HeatingThresholdTemperature + 4°C (max 30°C)
      if (this.acStates.TargetHeatingCoolingState === 3) { // Auto mode
        const coolingThreshold = Math.min(temperature + 4, 30);
        this.acStates.CoolingThresholdTemperature = coolingThreshold;
        this.updateCharacteristicCache('CoolingThresholdTemperature', coolingThreshold);
        this.platform.log.debug(`Auto mode: Updated CoolingThresholdTemperature to ${coolingThreshold}°C (HeatingThresholdTemperature + 4°C)`);
      } else {
        this.updateCharacteristicCache('CoolingThresholdTemperature', temperature);
      }
      
      this.platform.log.info(`Successfully set target temperature to ${temperature}°C`);
    } else {
      this.platform.log.error(`Failed to set target temperature to ${temperature}°C`);
      // Don't update local state if API call failed
    }
  }

  /**
   * Handle "GET" requests from HomeKit for TargetTemperature
   */
  async getTargetTemperature(): Promise<CharacteristicValue> {
    const cacheKey = 'TargetTemperature';
    const now = Date.now();
    
    // Check if we have a valid cache for this characteristic
    if (this.characteristicCaches[cacheKey] && 
        (now - this.characteristicCaches[cacheKey].timestamp) < this.CHARACTERISTIC_CACHE_DURATION) {
      const cachedValue = this.characteristicCaches[cacheKey].value;
      this.platform.log.debug(`Get Characteristic TargetTemperature -> ${cachedValue}°C (cached)`);
      return cachedValue;
    }
    
    const status = await this.getDeviceStatus();
    if (status) {
      const targetTemperature = status.components.main.thermostatCoolingSetpoint.coolingSetpoint.value;
      const acMode = status.components.main.airConditionerMode.airConditionerMode.value;
      const homeKitMode = this.samsungModeToHomeKit(acMode);
      
      this.acStates.TargetTemperature = targetTemperature;
      this.acStates.HeatingThresholdTemperature = targetTemperature;
      
      // For Auto mode, set CoolingThresholdTemperature to HeatingThresholdTemperature + 4°C (max 30°C)
      // This makes it easier to control in HomeKit when the knobs are not at the same point
      if (homeKitMode === 3) { // Auto mode
        const coolingThreshold = Math.min(targetTemperature + 4, 30);
        this.acStates.CoolingThresholdTemperature = coolingThreshold;
        this.platform.log.debug(`Auto mode: HeatingThresholdTemperature=${targetTemperature}°C, CoolingThresholdTemperature=${coolingThreshold}°C`);
      } else {
        this.acStates.CoolingThresholdTemperature = targetTemperature;
      }
      
      // Cache the result
      this.characteristicCaches[cacheKey] = {
        value: targetTemperature,
        timestamp: now,
      };
      
      this.platform.log.debug(`Get Characteristic TargetTemperature -> ${targetTemperature}°C`);
      return targetTemperature;
    }
    
    // Fallback to cached state if API fails
    this.platform.log.debug(`Get Characteristic TargetTemperature -> ${this.acStates.TargetTemperature}°C (fallback)`);
    return this.acStates.TargetTemperature;
  }

  /**
   * Handle "SET" requests from HomeKit for CoolingThresholdTemperature
   */
  async setCoolingThresholdTemperature(value: CharacteristicValue) {
    const temperature = value as number;
    
    // Validate temperature range
    if (temperature < 18 || temperature > 30) {
      this.platform.log.warn(`Cooling temperature ${temperature} is out of range (18-30). Clamping to valid range.`);
      this.acStates.CoolingThresholdTemperature = Math.max(18, Math.min(30, temperature));
    } else {
      this.acStates.CoolingThresholdTemperature = temperature;
    }
    
    this.platform.log.debug(`Set Characteristic CoolingThresholdTemperature -> ${this.acStates.CoolingThresholdTemperature}°C`);
    
    // If in Auto mode, update HeatingThresholdTemperature to CoolingThresholdTemperature - 4°C (min 18°C)
    if (this.acStates.TargetHeatingCoolingState === 3) {
      const heatingThreshold = Math.max(this.acStates.CoolingThresholdTemperature - 4, 18);
      this.acStates.HeatingThresholdTemperature = heatingThreshold;
      this.platform.log.debug(`Auto mode: Updated HeatingThresholdTemperature to ${heatingThreshold}°C (CoolingThresholdTemperature - 4°C)`);
      
      // Send command to SmartThings API to set target temperature to HeatingThresholdTemperature
      const success = await this.platform.setTargetTemperature(this.acStates.HeatingThresholdTemperature);
      
      if (success) {
        this.acStates.TargetTemperature = this.acStates.HeatingThresholdTemperature;
        
        // Update caches with new values
        this.updateCharacteristicCache('TargetTemperature', this.acStates.TargetTemperature);
        this.updateCharacteristicCache('HeatingThresholdTemperature', this.acStates.HeatingThresholdTemperature);
        this.updateCharacteristicCache('CoolingThresholdTemperature', this.acStates.CoolingThresholdTemperature);
        
        this.platform.log.info(`Auto mode: Successfully set target temperature to ${this.acStates.HeatingThresholdTemperature}°C`);
      } else {
        this.platform.log.error(`Auto mode: Failed to set target temperature to ${this.acStates.HeatingThresholdTemperature}°C`);
        // Don't update local state if API call failed
      }
    }
  }

  /**
   * Handle "GET" requests from HomeKit for CoolingThresholdTemperature
   */
  async getCoolingThresholdTemperature(): Promise<CharacteristicValue> {
    const cacheKey = 'CoolingThresholdTemperature';
    const now = Date.now();
    
    // Check if we have a valid cache for this characteristic
    if (this.characteristicCaches[cacheKey] && 
        (now - this.characteristicCaches[cacheKey].timestamp) < this.CHARACTERISTIC_CACHE_DURATION) {
      const cachedValue = this.characteristicCaches[cacheKey].value;
      this.platform.log.debug(`Get Characteristic CoolingThresholdTemperature -> ${cachedValue}°C (cached)`);
      return cachedValue;
    }
    
    const status = await this.getDeviceStatus();
    if (status) {
      const targetTemperature = status.components.main.thermostatCoolingSetpoint.coolingSetpoint.value;
      const acMode = status.components.main.airConditionerMode.airConditionerMode.value;
      const homeKitMode = this.samsungModeToHomeKit(acMode);
      
      let coolingThreshold: number;
      // For Auto mode, set CoolingThresholdTemperature to HeatingThresholdTemperature + 4°C (max 30°C)
      if (homeKitMode === 3) { // Auto mode
        coolingThreshold = Math.min(targetTemperature + 4, 30);
        this.platform.log.debug(`Auto mode: CoolingThresholdTemperature=${coolingThreshold}°C (HeatingThresholdTemperature + 4°C)`);
      } else {
        coolingThreshold = targetTemperature;
        this.platform.log.debug(`Get Characteristic CoolingThresholdTemperature -> ${targetTemperature}°C`);
      }
      
      this.acStates.CoolingThresholdTemperature = coolingThreshold;
      
      // Cache the result
      this.characteristicCaches[cacheKey] = {
        value: coolingThreshold,
        timestamp: now,
      };
      
      return coolingThreshold;
    }
    
    // Fallback to cached state if API fails
    this.platform.log.debug(`Get Characteristic CoolingThresholdTemperature -> ${this.acStates.CoolingThresholdTemperature}°C (fallback)`);
    return this.acStates.CoolingThresholdTemperature;
  }

  /**
   * Handle "SET" requests from HomeKit for HeatingThresholdTemperature
   */
  async setHeatingThresholdTemperature(value: CharacteristicValue) {
    const temperature = value as number;
    
    // Validate temperature range
    if (temperature < 18 || temperature > 30) {
      this.platform.log.warn(`Heating temperature ${temperature} is out of range (18-30). Clamping to valid range.`);
      this.acStates.HeatingThresholdTemperature = Math.max(18, Math.min(30, temperature));
    } else {
      this.acStates.HeatingThresholdTemperature = temperature;
    }
    
    this.platform.log.debug(`Set Characteristic HeatingThresholdTemperature -> ${this.acStates.HeatingThresholdTemperature}°C`);
    
    // If in Auto mode, also update CoolingThresholdTemperature to HeatingThresholdTemperature + 4°C (max 30°C)
    if (this.acStates.TargetHeatingCoolingState === 3) {
      const coolingThreshold = Math.min(this.acStates.HeatingThresholdTemperature + 4, 30);
      this.acStates.CoolingThresholdTemperature = coolingThreshold;
      this.platform.log.debug(`Auto mode: Updated CoolingThresholdTemperature to ${coolingThreshold}°C (HeatingThresholdTemperature + 4°C)`);
    }
    
    // Send command to SmartThings API to set target temperature
    const success = await this.platform.setTargetTemperature(this.acStates.HeatingThresholdTemperature);
    
    if (success) {
      this.acStates.TargetTemperature = this.acStates.HeatingThresholdTemperature;
      
      // Update caches with new values
      this.updateCharacteristicCache('TargetTemperature', this.acStates.TargetTemperature);
      this.updateCharacteristicCache('HeatingThresholdTemperature', this.acStates.HeatingThresholdTemperature);
      this.updateCharacteristicCache('CoolingThresholdTemperature', this.acStates.CoolingThresholdTemperature);
      
      this.platform.log.info(`Successfully set target temperature to ${this.acStates.HeatingThresholdTemperature}°C`);
    } else {
      this.platform.log.error(`Failed to set target temperature to ${this.acStates.HeatingThresholdTemperature}°C`);
      // Don't update local state if API call failed
    }
  }

  /**
   * Handle "GET" requests from HomeKit for HeatingThresholdTemperature
   */
  async getHeatingThresholdTemperature(): Promise<CharacteristicValue> {
    const cacheKey = 'HeatingThresholdTemperature';
    const now = Date.now();
    
    // Check if we have a valid cache for this characteristic
    if (this.characteristicCaches[cacheKey] && 
        (now - this.characteristicCaches[cacheKey].timestamp) < this.CHARACTERISTIC_CACHE_DURATION) {
      const cachedValue = this.characteristicCaches[cacheKey].value;
      this.platform.log.debug(`Get Characteristic HeatingThresholdTemperature -> ${cachedValue}°C (cached)`);
      return cachedValue;
    }
    
    const status = await this.getDeviceStatus();
    if (status) {
      const targetTemperature = status.components.main.thermostatCoolingSetpoint.coolingSetpoint.value;
      this.acStates.HeatingThresholdTemperature = targetTemperature;
      
      // Cache the result
      this.characteristicCaches[cacheKey] = {
        value: targetTemperature,
        timestamp: now,
      };
      
      this.platform.log.debug(`Get Characteristic HeatingThresholdTemperature -> ${targetTemperature}°C`);
      return targetTemperature;
    }
    
    // Fallback to cached state if API fails
    this.platform.log.debug(`Get Characteristic HeatingThresholdTemperature -> ${this.acStates.HeatingThresholdTemperature}°C (fallback)`);
    return this.acStates.HeatingThresholdTemperature;
  }

  /**
   * Handle "SET" requests from HomeKit for TemperatureDisplayUnits
   */
  async setTemperatureDisplayUnits(value: CharacteristicValue) {
    this.acStates.TemperatureDisplayUnits = value as number;
    this.platform.log.debug('Set Characteristic TemperatureDisplayUnits ->', value);
  }

  /**
   * Handle "GET" requests from HomeKit for TemperatureDisplayUnits
   */
  async getTemperatureDisplayUnits(): Promise<CharacteristicValue> {
    const units = this.acStates.TemperatureDisplayUnits;
    this.platform.log.debug('Get Characteristic TemperatureDisplayUnits ->', units);
    return units;
  }

  /**
   * Handle "GET" requests from HomeKit for CurrentHumidity
   */
  async getCurrentHumidity(): Promise<CharacteristicValue> {
    const cacheKey = 'CurrentHumidity';
    const now = Date.now();
    
    // Check if we have a valid cache for this characteristic
    if (this.characteristicCaches[cacheKey] && 
        (now - this.characteristicCaches[cacheKey].timestamp) < this.CHARACTERISTIC_CACHE_DURATION) {
      const cachedValue = this.characteristicCaches[cacheKey].value;
      this.platform.log.debug(`Get Characteristic CurrentRelativeHumidity -> ${cachedValue}% (cached)`);
      return cachedValue;
    }
    
    const status = await this.getDeviceStatus();
    if (status) {
      const humidity = status.components.main.relativeHumidityMeasurement.humidity.value;
      this.acStates.CurrentHumidity = humidity;
      
      // Cache the result
      this.characteristicCaches[cacheKey] = {
        value: humidity,
        timestamp: now,
      };
      
      this.platform.log.debug(`Get Characteristic CurrentRelativeHumidity -> ${humidity}%`);
      return humidity;
    }
    
    // Fallback to cached state if API fails
    this.platform.log.debug(`Get Characteristic CurrentRelativeHumidity -> ${this.acStates.CurrentHumidity}% (fallback)`);
    return this.acStates.CurrentHumidity;
  }
}
