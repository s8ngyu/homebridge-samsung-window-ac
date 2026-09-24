import type { PlatformConfig } from 'homebridge';

export interface SamsungConfig {
  name: string;
  deviceId: string;
  deviceIp: string;
  componentId: string;
  authMode: 'oauth' | 'pat';
  personalAccessToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  pollInterval: number;
  requestTimeout: number;
  minimumTemperature: number;
  maximumTemperature: number;
  temperatureStep: number;
  coolMode: string;
  autoMode: string;
  dryMode: string;
  fanOnlyMode: string;
  swingOnMode: string;
  swingOffMode: string;
  autoThresholdGap: number;
  fanModes: string[];
  powerCapability: string;
  modeCapability: string;
  setpointCapability: string;
  temperatureCapability: string;
  humidityCapability: string;
  fanCapability: string;
  swingCapability: string;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function parseConfig(config: PlatformConfig): SamsungConfig {
  const minimumTemperature = numberValue(config.minimumTemperature, 18, -20, 50);
  const maximumTemperature = numberValue(config.maximumTemperature, 30, minimumTemperature + 1, 60);
  return {
    name: stringValue(config.name, 'Samsung Window AC'),
    deviceId: stringValue(config.deviceId),
    deviceIp: stringValue(config.deviceIp),
    componentId: stringValue(config.componentId, 'main'),
    authMode: config.authMode === 'pat' ? 'pat' : 'oauth',
    personalAccessToken: stringValue(config.personalAccessToken),
    clientId: stringValue(config.clientId),
    clientSecret: stringValue(config.clientSecret),
    refreshToken: stringValue(config.refreshToken),
    pollInterval: numberValue(config.pollInterval, 30, 10, 3600),
    requestTimeout: numberValue(config.requestTimeout, 10, 2, 60),
    minimumTemperature,
    maximumTemperature,
    temperatureStep: numberValue(config.temperatureStep, 1, 0.1, 5),
    coolMode: stringValue(config.coolMode, 'cool'),
    autoMode: stringValue(config.autoMode, 'aIComfort'),
    dryMode: stringValue(config.dryMode, 'dry'),
    fanOnlyMode: stringValue(config.fanOnlyMode, 'fan'),
    swingOnMode: stringValue(config.swingOnMode, 'horizontal'),
    swingOffMode: stringValue(config.swingOffMode, 'fixed'),
    autoThresholdGap: numberValue(config.autoThresholdGap, 4, 0, 10),
    fanModes: stringValue(config.fanModes, 'auto,1,2,3,4,5')
      .split(',').map(value => value.trim()).filter(Boolean),
    powerCapability: stringValue(config.powerCapability, 'switch'),
    modeCapability: stringValue(config.modeCapability),
    setpointCapability: stringValue(config.setpointCapability),
    temperatureCapability: stringValue(config.temperatureCapability, 'temperatureMeasurement'),
    humidityCapability: stringValue(config.humidityCapability, 'relativeHumidityMeasurement'),
    fanCapability: stringValue(config.fanCapability, 'airConditionerFanMode'),
    swingCapability: stringValue(config.swingCapability, 'fanOscillationMode'),
  };
}
