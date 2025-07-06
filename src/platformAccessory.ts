import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { SamsungWindowACPlatform } from './platform.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SamsungWindowACAccessory {
  private service: Service;

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
    TemperatureDisplayUnits: 0, // 0: Celsius, 1: Fahrenheit
  };

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
    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onSet(this.setTargetTemperature.bind(this))
      .onGet(this.getTargetTemperature.bind(this));

    // register handlers for the CoolingThresholdTemperature Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .onSet(this.setCoolingThresholdTemperature.bind(this))
      .onGet(this.getCoolingThresholdTemperature.bind(this))
      .setProps({
        minValue: 18,
        maxValue: 30,
        minStep: 1,
      });

    // register handlers for the HeatingThresholdTemperature Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .onSet(this.setHeatingThresholdTemperature.bind(this))
      .onGet(this.getHeatingThresholdTemperature.bind(this))
      .setProps({
        minValue: 18,
        maxValue: 30,
        minStep: 1,
      });

    // register handlers for the TemperatureDisplayUnits Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onSet(this.setTemperatureDisplayUnits.bind(this))
      .onGet(this.getTemperatureDisplayUnits.bind(this));
  }

  /**
   * Handle "SET" requests from HomeKit for Active
   */
  async setActive(value: CharacteristicValue) {
    this.acStates.Active = value as boolean;
    
    if (!this.acStates.Active) {
      this.acStates.CurrentHeatingCoolingState = 0;
      this.acStates.TargetHeatingCoolingState = 0;
    }

    this.platform.log.debug('Set Characteristic Active ->', value);
    
    // TODO: Implement actual Samsung AC control here
    // This is where you would send commands to the Samsung AC device
  }

  /**
   * Handle "GET" requests from HomeKit for Active
   */
  async getActive(): Promise<CharacteristicValue> {
    const isActive = this.acStates.Active;
    this.platform.log.debug('Get Characteristic Active ->', isActive);
    return isActive;
  }

  /**
   * Handle "GET" requests from HomeKit for CurrentHeatingCoolingState
   */
  async getCurrentHeatingCoolingState(): Promise<CharacteristicValue> {
    const state = this.acStates.CurrentHeatingCoolingState;
    this.platform.log.debug('Get Characteristic CurrentHeatingCoolingState ->', state);
    return state;
  }

  /**
   * Handle "SET" requests from HomeKit for TargetHeatingCoolingState
   */
  async setTargetHeatingCoolingState(value: CharacteristicValue) {
    this.acStates.TargetHeatingCoolingState = value as number;
    
    if (this.acStates.Active) {
      this.acStates.CurrentHeatingCoolingState = value as number;
    }

    this.platform.log.debug('Set Characteristic TargetHeatingCoolingState ->', value);
    
    // TODO: Implement actual Samsung AC control here
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
    const temperature = this.acStates.CurrentTemperature;
    this.platform.log.debug('Get Characteristic CurrentTemperature ->', temperature);
    return temperature;
  }

  /**
   * Handle "SET" requests from HomeKit for TargetTemperature
   */
  async setTargetTemperature(value: CharacteristicValue) {
    const temperature = value as number;
    
    // Validate temperature range
    if (temperature < 18 || temperature > 30) {
      this.platform.log.warn(`Temperature ${temperature} is out of range (18-30). Clamping to valid range.`);
      this.acStates.TargetTemperature = Math.max(18, Math.min(30, temperature));
    } else {
      this.acStates.TargetTemperature = temperature;
    }
    
    this.platform.log.debug('Set Characteristic TargetTemperature ->', this.acStates.TargetTemperature);
    
    // TODO: Implement actual Samsung AC control here
  }

  /**
   * Handle "GET" requests from HomeKit for TargetTemperature
   */
  async getTargetTemperature(): Promise<CharacteristicValue> {
    const temperature = this.acStates.TargetTemperature;
    this.platform.log.debug('Get Characteristic TargetTemperature ->', temperature);
    return temperature;
  }

  /**
   * Handle "SET" requests from HomeKit for CoolingThresholdTemperature
   */
  async setCoolingThresholdTemperature(value: CharacteristicValue) {
    this.acStates.CoolingThresholdTemperature = value as number;
    this.platform.log.debug('Set Characteristic CoolingThresholdTemperature ->', value);
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
    this.acStates.HeatingThresholdTemperature = value as number;
    this.platform.log.debug('Set Characteristic HeatingThresholdTemperature ->', value);
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
}
