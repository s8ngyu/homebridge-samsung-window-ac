import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { SamsungWindowACPlatform } from './platform.js';
import type { DeviceDescription, DeviceStatus } from './smartthings.js';

type Attribute = { value?: unknown; unit?: string };

function read(status: DeviceStatus, component: string, capability: string, name: string): Attribute {
  return status.components?.[component]?.[capability]?.[name] || {};
}

function celsius(attribute: Attribute): number | undefined {
  const value = Number(attribute.value);
  if (attribute.value === null || attribute.value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return attribute.unit === 'F' ? (value - 32) * 5 / 9 : value;
}

export class SamsungWindowACAccessory {
  private readonly thermostat: Service;
  private readonly humidity: Service;
  private readonly fan: Service;
  private readonly fanOnly: Service;
  private device?: DeviceDescription;
  private status?: DeviceStatus;
  private updatedAt = 0;
  private refreshInFlight?: Promise<void>;
  private fanModes: string[];

  constructor(
    private readonly platform: SamsungWindowACPlatform,
    private readonly accessory: PlatformAccessory,
    device?: DeviceDescription,
  ) {
    this.device = device;
    const { Service, Characteristic, settings } = platform;
    this.fanModes = settings.fanModes;

    accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, device?.manufacturerName || 'Samsung')
      .setCharacteristic(Characteristic.Model, device?.deviceModel || 'Samsung Window A/C')
      .setCharacteristic(Characteristic.SerialNumber, device?.deviceId || settings.deviceId || settings.deviceIp);

    this.thermostat = accessory.getService(Service.Thermostat) || accessory.addService(Service.Thermostat);
    this.thermostat.setCharacteristic(Characteristic.Name, settings.name);
    this.thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .onGet(() => this.get(() => this.currentMode()));
    this.thermostat.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .setProps({ validValues: [0, 1, 2, 3] })
      .onGet(() => this.get(() => this.targetMode()))
      .onSet(value => this.setMode(value));
    this.thermostat.getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(() => this.get(() => this.temperature()));
    for (const characteristic of [
      Characteristic.TargetTemperature,
      Characteristic.HeatingThresholdTemperature,
      Characteristic.CoolingThresholdTemperature,
    ]) {
      this.thermostat.getCharacteristic(characteristic)
        .setProps({ minValue: settings.minimumTemperature, maxValue: settings.maximumTemperature, minStep: settings.temperatureStep });
    }
    this.thermostat.getCharacteristic(Characteristic.TargetTemperature)
      .onGet(() => this.get(() => this.setpoint()))
      .onSet(value => this.setTemperature(Number(value)));
    this.thermostat.getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .onGet(() => this.get(() => this.setpoint()))
      .onSet(value => this.setTemperature(Number(value)));
    this.thermostat.getCharacteristic(Characteristic.HeatingThresholdTemperature)
      .onGet(() => this.get(() => this.heatingThreshold()))
      .onSet(value => this.setTemperature(Number(value) + settings.autoThresholdGap));
    this.thermostat.getCharacteristic(Characteristic.TemperatureDisplayUnits)
      .onGet(() => Characteristic.TemperatureDisplayUnits.CELSIUS);
    // Kept for compatibility with the prior version's optional Active characteristic.
    this.thermostat.getCharacteristic(Characteristic.Active)
      .onGet(() => this.get(() => this.isOn() ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE))
      .onSet(value => this.setPower(value === Characteristic.Active.ACTIVE));

    this.humidity = accessory.getService(Service.HumiditySensor) || accessory.addService(Service.HumiditySensor);
    this.humidity.setCharacteristic(Characteristic.Name, `${settings.name} Humidity`);
    this.humidity.getCharacteristic(Characteristic.CurrentRelativeHumidity)
      .onGet(() => this.get(() => this.relativeHumidity()));

    this.fan = accessory.getService(Service.Fanv2) || accessory.addService(Service.Fanv2, `${settings.name} Fan`);
    this.fan.getCharacteristic(Characteristic.Active)
      .onGet(() => this.get(() => this.isOn() ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE))
      .onSet(value => this.setPower(value === Characteristic.Active.ACTIVE));
    this.fan.getCharacteristic(Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(() => this.get(() => this.rotationSpeed()))
      .onSet(value => this.setFanSpeed(Number(value)));
    this.fan.getCharacteristic(Characteristic.SwingMode)
      .onGet(() => this.get(() => this.swingMode()))
      .onSet(value => this.setSwing(value === Characteristic.SwingMode.SWING_ENABLED));

    this.fanOnly = accessory.getServiceById(Service.Switch, 'fan-only') ||
      accessory.addService(Service.Switch, `${settings.name} Fan Only`, 'fan-only');
    this.fanOnly.getCharacteristic(Characteristic.On)
      .onGet(() => this.get(() => this.isOn() && this.samsungMode() === settings.fanOnlyMode))
      .onSet(value => this.setFanOnly(Boolean(value)));

    void this.start();
  }

  private async start(): Promise<void> {
    await this.poll();
    const timer = setInterval(() => void this.poll(), this.platform.settings.pollInterval * 1000);
    timer.unref();
  }

  private async poll(): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      this.platform.log.warn(`Samsung Window AC status: ${(error as Error).message}`);
    }
  }

  private async refresh(): Promise<void> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    this.refreshInFlight = (async () => {
      if (!this.device) {
        this.device = await this.platform.client.findDevice();
      }
      const status = await this.platform.client.status(this.device.deviceId);
      this.status = status;
      this.updatedAt = Date.now();
      const available = read(status, this.platform.settings.componentId, this.platform.settings.fanCapability, 'availableAcFanModes').value;
      if (Array.isArray(available)) {
        const valid = this.platform.settings.fanModes.filter(mode => available.includes(mode));
        if (valid.length) {
          this.fanModes = valid;
        }
      }
      this.publish();
    })();
    try {
      await this.refreshInFlight;
    } finally {
      this.refreshInFlight = undefined;
    }
  }

  private async get(value: () => CharacteristicValue): Promise<CharacteristicValue> {
    try {
      if (!this.status || Date.now() - this.updatedAt > this.platform.settings.pollInterval * 1000) {
        await this.refresh();
      }
      return value();
    } catch (error) {
      this.platform.log.warn(`Samsung Window AC read: ${(error as Error).message}`);
      throw this.communicationError();
    }
  }

  private communicationError(): Error {
    const { HapStatusError, HAPStatus } = this.platform.api.hap;
    return new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  private value(capability: string, name: string): unknown {
    return read(this.status || {}, this.platform.settings.componentId, capability, name).value;
  }

  private isOn(): boolean {
    return this.value(this.platform.settings.powerCapability, 'switch') === 'on';
  }

  private samsungMode(): string {
    return String(this.value(this.platform.settings.modeCapability || 'airConditionerMode', 'airConditionerMode') || '');
  }

  private targetMode(): number {
    const { Characteristic, settings } = this.platform;
    if (!this.isOn()) {
      return Characteristic.TargetHeatingCoolingState.OFF;
    }
    const mode = this.samsungMode();
    if (mode === settings.dryMode) {
      return Characteristic.TargetHeatingCoolingState.HEAT;
    }
    if (mode === settings.fanOnlyMode) {
      return Characteristic.TargetHeatingCoolingState.OFF;
    }
    if (mode === settings.autoMode) {
      return Characteristic.TargetHeatingCoolingState.AUTO;
    }
    return Characteristic.TargetHeatingCoolingState.COOL;
  }

  private currentMode(): number {
    const { Characteristic } = this.platform;
    if (!this.isOn()) {
      return Characteristic.CurrentHeatingCoolingState.OFF;
    }
    if (this.samsungMode() === this.platform.settings.dryMode) {
      return Characteristic.CurrentHeatingCoolingState.HEAT;
    }
    if (this.samsungMode() === this.platform.settings.fanOnlyMode) {
      return Characteristic.CurrentHeatingCoolingState.OFF;
    }
    // SmartThings does not expose compressor state on this model.
    return Characteristic.CurrentHeatingCoolingState.COOL;
  }

  private temperature(): number {
    const { settings } = this.platform;
    const value = celsius(read(this.status || {}, settings.componentId, settings.temperatureCapability, 'temperature'));
    if (value === undefined) {
      throw this.communicationError();
    }
    return value;
  }

  private setpoint(): number {
    const { settings } = this.platform;
    const value = celsius(read(this.status || {}, settings.componentId, settings.setpointCapability || 'thermostatCoolingSetpoint', 'coolingSetpoint'));
    if (value === undefined) {
      throw this.communicationError();
    }
    return value;
  }

  private heatingThreshold(): number {
    return Math.max(this.platform.settings.minimumTemperature, this.setpoint() - this.platform.settings.autoThresholdGap);
  }

  private relativeHumidity(): number {
    const raw = this.value(this.platform.settings.humidityCapability, 'humidity');
    const value = Number(raw);
    if (raw === null || raw === undefined || !Number.isFinite(value)) {
      throw this.communicationError();
    }
    return Math.max(0, Math.min(100, value));
  }

  private rotationSpeed(): number {
    const mode = String(this.value(this.platform.settings.fanCapability, 'fanMode'));
    const index = this.fanModes.indexOf(mode);
    return index < 0 ? 0 : Math.round(index * 100 / Math.max(1, this.fanModes.length - 1));
  }

  private swingMode(): number {
    const { Characteristic, settings } = this.platform;
    const mode = this.value(settings.swingCapability, 'fanOscillationMode');
    return mode === settings.swingOnMode ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED;
  }

  private publish(): void {
    const { Characteristic } = this.platform;
    try {
      this.thermostat.updateCharacteristic(Characteristic.Active, this.isOn() ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
      this.thermostat.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, this.currentMode());
      this.thermostat.updateCharacteristic(Characteristic.TargetHeatingCoolingState, this.targetMode());
      this.thermostat.updateCharacteristic(Characteristic.CurrentTemperature, this.temperature());
      this.thermostat.updateCharacteristic(Characteristic.TargetTemperature, this.setpoint());
      this.thermostat.updateCharacteristic(Characteristic.CoolingThresholdTemperature, this.setpoint());
      this.thermostat.updateCharacteristic(Characteristic.HeatingThresholdTemperature, this.heatingThreshold());
      this.humidity.updateCharacteristic(Characteristic.CurrentRelativeHumidity, this.relativeHumidity());
      this.fan.updateCharacteristic(Characteristic.Active, this.isOn() ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
      this.fan.updateCharacteristic(Characteristic.RotationSpeed, this.rotationSpeed());
      this.fan.updateCharacteristic(Characteristic.SwingMode, this.swingMode());
      this.fanOnly.updateCharacteristic(Characteristic.On, this.isOn() && this.samsungMode() === this.platform.settings.fanOnlyMode);
    } catch (error) {
      this.platform.log.warn(`Samsung Window AC status is incomplete: ${(error as Error).message}`);
    }
  }

  private async command(capability: string, command: string, args: unknown[] = []): Promise<void> {
    try {
      if (!this.device) {
        this.device = await this.platform.client.findDevice();
      }
      await this.platform.client.command(this.device.deviceId, this.platform.settings.componentId, capability, command, args);
      const timer = setTimeout(() => void this.poll(), 2000);
      timer.unref();
    } catch (error) {
      this.platform.log.error(`Samsung Window AC ${capability}.${command}: ${(error as Error).message}`);
      throw this.communicationError();
    }
  }

  private async setPower(on: boolean): Promise<void> {
    await this.command(this.platform.settings.powerCapability, on ? 'on' : 'off');
  }

  private async setMode(value: CharacteristicValue): Promise<void> {
    const { Characteristic, settings } = this.platform;
    if (value === Characteristic.TargetHeatingCoolingState.OFF) {
      await this.setPower(false);
      return;
    }
    const mode = value === Characteristic.TargetHeatingCoolingState.HEAT ? settings.dryMode :
      value === Characteristic.TargetHeatingCoolingState.AUTO ? settings.autoMode : settings.coolMode;
    const supported = this.value(settings.modeCapability || 'airConditionerMode', 'availableAcModes');
    if (Array.isArray(supported) && !supported.includes(mode)) {
      throw this.communicationError();
    }
    await this.command(settings.modeCapability || 'airConditionerMode', 'setAirConditionerMode', [mode]);
    if (!this.isOn()) {
      await this.setPower(true);
    }
  }

  private async setTemperature(value: number): Promise<void> {
    const { settings } = this.platform;
    if (!Number.isFinite(value) || value < settings.minimumTemperature || value > settings.maximumTemperature) {
      throw this.communicationError();
    }
    await this.command(settings.setpointCapability || 'thermostatCoolingSetpoint', 'setCoolingSetpoint', [value]);
  }

  private async setFanSpeed(value: number): Promise<void> {
    if (!Number.isFinite(value) || !this.fanModes.length) {
      throw this.communicationError();
    }
    const index = Math.max(0, Math.min(this.fanModes.length - 1, Math.round(value * (this.fanModes.length - 1) / 100)));
    await this.command(this.platform.settings.fanCapability, 'setFanMode', [this.fanModes[index]]);
  }

  private async setSwing(on: boolean): Promise<void> {
    const { settings } = this.platform;
    await this.command(settings.swingCapability, 'setFanOscillationMode', [on ? settings.swingOnMode : settings.swingOffMode]);
  }

  private async setFanOnly(on: boolean): Promise<void> {
    const { settings } = this.platform;
    if (on) {
      await this.command(settings.modeCapability || 'airConditionerMode', 'setAirConditionerMode', [settings.fanOnlyMode]);
      if (!this.isOn()) {
        await this.setPower(true);
      }
    } else if (this.isOn() && this.samsungMode() === settings.fanOnlyMode) {
      await this.command(settings.modeCapability || 'airConditionerMode', 'setAirConditionerMode', [settings.coolMode]);
    }
  }
}
