import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { SamsungWindowACPlatform } from './platform.js';

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
    // Get switch status from SmartThings API
    const switchStatus = await this.platform.getSwitchStatus();
    
    if (switchStatus !== null) {
      const isActive = switchStatus === 'on';
      this.acStates.Active = isActive;
      this.platform.log.debug(`Get Characteristic Active from SmartThings (${switchStatus}) -> ${isActive}`);
      return isActive;
    } else {
      // Fallback to cached state if API call fails
      const cachedActive = this.acStates.Active;
      this.platform.log.debug('Get Characteristic Active from cache ->', cachedActive);
      return cachedActive;
    }
  }

  /**
   * Handle "GET" requests from HomeKit for CurrentHeatingCoolingState
   */
  async getCurrentHeatingCoolingState(): Promise<CharacteristicValue> {
    // Get AC mode from SmartThings API
    const samsungMode = await this.platform.getCurrentACMode();
    
    if (samsungMode !== null) {
      const homeKitMode = this.samsungModeToHomeKit(samsungMode);
      this.acStates.CurrentHeatingCoolingState = homeKitMode;
      this.platform.log.debug(`Get Characteristic CurrentHeatingCoolingState from SmartThings (${samsungMode} -> ${homeKitMode})`);
      return homeKitMode;
    } else {
      // Fallback to cached state if API call fails
      const cachedState = this.acStates.CurrentHeatingCoolingState;
      this.platform.log.debug('Get Characteristic CurrentHeatingCoolingState from cache ->', cachedState);
      return cachedState;
    }
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
      }
    } else {
      // Other modes - use airConditionerMode command
      success = await this.platform.setACMode(samsungMode);
    }
    
    if (success) {
      this.acStates.TargetHeatingCoolingState = homeKitMode;
      
      if (this.acStates.Active) {
        this.acStates.CurrentHeatingCoolingState = homeKitMode;
      }
      
      if (homeKitMode === 0) {
        this.acStates.Active = false;
        this.platform.log.info('Successfully turned off AC');
      } else if (homeKitMode === 3) {
        this.acStates.Active = true;
        this.platform.log.info(`Successfully changed AC mode to ${samsungMode} (HomeKit: ${homeKitMode}) with target temperature: ${this.acStates.HeatingThresholdTemperature}°C`);
      } else {
        this.acStates.Active = true;
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
    const state = this.acStates.TargetHeatingCoolingState;
    this.platform.log.debug('Get Characteristic TargetHeatingCoolingState ->', state);
    return state;
  }

  /**
   * Handle "GET" requests from HomeKit for CurrentTemperature
   */
  async getCurrentTemperature(): Promise<CharacteristicValue> {
    // Get temperature from SmartThings API
    const temperature = await this.platform.getCurrentTemperature();
    
    if (temperature !== null) {
      this.acStates.CurrentTemperature = temperature;
      this.platform.log.debug('Get Characteristic CurrentTemperature from SmartThings ->', temperature);
      return temperature;
    } else {
      // Fallback to cached temperature if API call fails
      const cachedTemperature = this.acStates.CurrentTemperature;
      this.platform.log.debug('Get Characteristic CurrentTemperature from cache ->', cachedTemperature);
      return cachedTemperature;
    }
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
    // If in Auto mode, return HeatingThresholdTemperature
    if (this.acStates.TargetHeatingCoolingState === 3) {
      const autoTargetTemp = this.acStates.HeatingThresholdTemperature;
      this.platform.log.debug('Auto mode: Get Characteristic TargetTemperature from HeatingThresholdTemperature ->', autoTargetTemp);
      return autoTargetTemp;
    }
    
    // Get target temperature from SmartThings API for other modes
    const targetTemperature = await this.platform.getTargetTemperature();
    
    if (targetTemperature !== null) {
      this.acStates.TargetTemperature = targetTemperature;
      this.platform.log.debug('Get Characteristic TargetTemperature from SmartThings ->', targetTemperature);
      return targetTemperature;
    } else {
      // Fallback to cached temperature if API call fails
      const cachedTemperature = this.acStates.TargetTemperature;
      this.platform.log.debug('Get Characteristic TargetTemperature from cache ->', cachedTemperature);
      return cachedTemperature;
    }
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
    
    this.platform.log.debug('Set Characteristic CoolingThresholdTemperature ->', this.acStates.CoolingThresholdTemperature);
  }

  /**
   * Handle "GET" requests from HomeKit for CoolingThresholdTemperature
   */
  async getCoolingThresholdTemperature(): Promise<CharacteristicValue> {
    const temperature = this.acStates.CoolingThresholdTemperature;
    this.platform.log.debug('Get Characteristic CoolingThresholdTemperature ->', temperature);
    return temperature;
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
    
    this.platform.log.debug('Set Characteristic HeatingThresholdTemperature ->', this.acStates.HeatingThresholdTemperature);
    
    // If currently in Auto mode, update target temperature
    if (this.acStates.TargetHeatingCoolingState === 3) {
      const success = await this.platform.setTargetTemperature(this.acStates.HeatingThresholdTemperature);
      if (success) {
        this.acStates.TargetTemperature = this.acStates.HeatingThresholdTemperature;
        this.platform.log.info(`Auto mode: Updated target temperature to ${this.acStates.HeatingThresholdTemperature}°C`);
      } else {
        this.platform.log.error(`Auto mode: Failed to update target temperature to ${this.acStates.HeatingThresholdTemperature}°C`);
      }
    }
  }

  /**
   * Handle "GET" requests from HomeKit for HeatingThresholdTemperature
   */
  async getHeatingThresholdTemperature(): Promise<CharacteristicValue> {
    const temperature = this.acStates.HeatingThresholdTemperature;
    this.platform.log.debug('Get Characteristic HeatingThresholdTemperature ->', temperature);
    return temperature;
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
    // Get humidity from SmartThings API
    const humidity = await this.platform.getCurrentHumidity();
    
    if (humidity !== null) {
      this.acStates.CurrentHumidity = humidity;
      this.platform.log.debug('Get Characteristic CurrentHumidity from SmartThings ->', humidity);
      return humidity;
    } else {
      // Fallback to cached humidity if API call fails
      const cachedHumidity = this.acStates.CurrentHumidity;
      this.platform.log.debug('Get Characteristic CurrentHumidity from cache ->', cachedHumidity);
      return cachedHumidity;
    }
  }
}
