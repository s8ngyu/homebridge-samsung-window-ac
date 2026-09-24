# Homebridge Samsung Window AC

Homebridge integration for a Samsung window air conditioner through the current SmartThings Devices API. The plugin exposes a thermostat, humidity sensor, and fan controls in Apple Home.

## Setup

Install or link the plugin, then open its settings in Homebridge UI. Set the **SmartThings device ID** and choose an authentication method:

- **OAuth**: enter a client ID, client secret, and fresh refresh token. The plugin refreshes access tokens automatically and writes rotated tokens to `samsung-window-ac/tokens-v2.json` in Homebridge's storage directory with mode `0600`. If you change the credentials in settings, the plugin discards the old stored tokens.
- **Personal access token**: enter a token with device read and command access. [New SmartThings personal access tokens expire after 24 hours](https://developer.smartthings.com/docs/getting-started/authorization-and-permissions), so this is useful for testing and requires replacement for continued use.

The device ID can be found through the SmartThings API or SmartThings CLI. If omitted, the plugin selects the sole device with air conditioner capabilities. Set it explicitly if you have multiple air conditioners or want the cached HomeKit accessory to remain visible while SmartThings is unavailable.

The optional **Air conditioner LAN IP** setting can be changed in Homebridge UI. This Samsung model does not expose a local control port on the network, so commands and status use SmartThings. The IP is used as identification metadata when a device ID is unavailable.

Save settings and restart Homebridge to apply changes.

SmartThings requires a public HTTPS hostname to complete OAuth authorization for this app. Its authorization page rejected localhost and a private LAN IP during testing. A redirect URI is needed only for a new authorization; normal device control and automatic token refresh do not cause browser redirects. If the token store and its configured refresh token are both lost or revoked, a callback URI will need to be registered again for reauthorization.

The plugin renews OAuth credentials independently of AC status every six hours while Homebridge is running, and also refreshes on demand before API calls. Unplugging the AC does not pause renewal. [SmartThings says refresh tokens last 30 days](https://developer.smartthings.com/docs/service-integrations/architecture-and-auth-flow), so if the Pi or Homebridge stays off for more than 30 days, reauthorization may be necessary.

## Controls

| Apple Home | SmartThings command |
| --- | --- |
| Off | `switch.off` |
| Cool | `airConditionerMode.setAirConditionerMode("cool")` and power on |
| Heat | `airConditionerMode.setAirConditionerMode("dry")` and power on |
| Auto | `airConditionerMode.setAirConditionerMode("aIComfort")` and power on |
| Target temperature | `thermostatCoolingSetpoint.setCoolingSetpoint` |
| Fan speed | `airConditionerFanMode.setFanMode` |
| Swing | `fanOscillationMode.setFanOscillationMode` |
| Fan Only switch | `airConditionerMode.setAirConditionerMode("fan")` |

The **Heat** label represents the AC's **Dry** mode for compatibility with the previous plugin. It does not heat the room. In Auto, Apple Home's cooling threshold is the actual AC target; the heating threshold is shown below it by the configurable threshold gap. The unit's current temperature and humidity are read from SmartThings. Fan speed and swing appear as a separate Fan service, and Fan Only as a switch.

The installed device reports an 18–30°C setpoint, fan modes `auto,1,2,3,4,5`, and swing modes `fixed,horizontal`. These and the polling interval, timeout, mode names, component, and capability IDs can all be changed in Homebridge settings for other models.

## Development

```sh
npm ci
npm run build
npm run lint
```
