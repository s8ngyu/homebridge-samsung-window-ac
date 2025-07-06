# Homebridge Samsung Window AC

A Homebridge plugin that integrates Samsung Window Air Conditioners with Apple HomeKit.

## Features

- ✅ Samsung Window AC temperature control
- ✅ Humidity monitoring
- ✅ Air conditioner mode control (Off, Cool, Heat, Auto)
- ✅ Real-time status synchronization
- ✅ SmartThings API integration
- ✅ HomeKit automation support

## Supported Modes

| HomeKit Mode | Samsung AC Mode | Description |
|-------------|----------------|-------------|
| Off | Off | Turn off air conditioner |
| Cool | Cool | Cooling mode |
| Heat | Dry | Dehumidification mode (mapped to Heat) |
| Auto | AI Comfort | AI Comfort mode |

## Installation

### 1. Install Homebridge

First, make sure you have Homebridge installed. If not:

```bash
sudo npm install -g homebridge homebridge-config-ui-x
```

### 2. Install Plugin

```bash
sudo npm install -g homebridge-samsung-window-ac
```

### 3. Set up SmartThings API Token

1. Log in to [SmartThings Developer Console](https://smartthings.developer.samsung.com/)
2. Create a Personal Access Token
3. Copy the token and enter it in the configuration

## Configuration

### Using Homebridge Config UI X

1. Access Homebridge Config UI X
2. Find "Samsung Window AC" in the plugins tab
3. Enter your SmartThings API token in the settings
4. Save and restart

### Manual Configuration

Add the following configuration to your `config.json` file:

```json
{
  "platforms": [
    {
      "platform": "SamsungWindowAC",
      "name": "Samsung Window AC",
      "apiToken": "your-smartthings-api-token-here"
    }
  ]
}
```

## Usage

### In HomeKit App

1. Open the Home app
2. Select the air conditioner accessory
3. Control temperature, change modes, turn on/off

### Automation Setup

- "Turn on AC when temperature is above 25°C"
- "Switch to dehumidification mode when humidity is above 70%"
- "Turn off AC when leaving home"

## Troubleshooting

### 429 Too Many Requests Error

The plugin optimizes API calls to prevent 429 errors:
- Uses unified status API to reduce call frequency
- 5-minute caching to prevent unnecessary requests

### Air Conditioner Not Detected

1. Verify the air conditioner is properly connected in the SmartThings app
2. Check if the API token is correct
3. Check error messages in Homebridge logs

### Temperature Control in Auto Mode

In Auto mode:
- HeatingThresholdTemperature is the actual target temperature
- CoolingThresholdTemperature is HeatingThresholdTemperature + 4°C (max 30°C)
- This setup makes it easier to control in HomeKit

## Development

### Local Development Environment Setup

```bash
# Clone repository
git clone https://github.com/s8ngyu/homebridge-samsung-window-ac.git
cd homebridge-samsung-window-ac

# Install dependencies
npm install

# Build
npm run build

# Link to Homebridge
npm link

# Run in development mode
npm run watch
```

### Build

```bash
npm run build
```

### Lint

```bash
npm run lint
```

## License

Apache License 2.0

## Contributing

Bug reports, feature requests, and pull requests are welcome!

## Support

If you have issues or questions, please contact us via [GitHub Issues](https://github.com/s8ngyu/homebridge-samsung-window-ac/issues).
