'use strict';

const {
  Adapter,
  Device,
  Property,
} = require('gateway-addon');
const Netatmo = require('netatmo');

const AVAILABLE_TYPES = [
  'NRV',
];
const DEVICE_PREFIX = 'thermostat-room-';

class ThermostatProperty extends Property {
  constructor(device, name, propertyDescription) {
    super(device, name, propertyDescription);
    this.setCachedValue(propertyDescription.value);
    this.device.notifyPropertyChanged(this);
  }
}

class TargetTemperatureProperty extends Property {
  constructor(device, name, propertyDescription) {
    super(device, name, propertyDescription);
    this.setCachedValue(propertyDescription.value);
    this.device.notifyPropertyChanged(this);
  }

  setValue(value) {
    return this.device.setRoomThermPoint(value);
  }
}

class ThermostatModeProperty extends Property {
  constructor(device, name, propertyDescription) {
    super(device, name, propertyDescription);
    this.setCachedValue(propertyDescription.value);
    this.device.notifyPropertyChanged(this);
  }

  setValue(value) {
    return this.device.setThermostatMode(value);
  }
}

class RoomDevice extends Device {
  constructor(adapter, id, deviceDescription) {
    super(adapter, id);
    this.title = deviceDescription.title;
    this.type = deviceDescription.type;
    this['@type'] = deviceDescription['@type'];
    this.description = deviceDescription.description;
    for (const propertyName in deviceDescription.properties) {
      const propertyDescription = deviceDescription.properties[propertyName];
      let property = new ThermostatProperty(this, propertyName, propertyDescription);

      if (propertyDescription['@type'] === 'TargetTemperatureProperty') {
        property = new TargetTemperatureProperty(this, propertyName, propertyDescription);
      } else if (propertyDescription['@type'] === 'ThermostatModeProperty') {
        property = new ThermostatModeProperty(this, propertyName, propertyDescription);
      }

      this.properties.set(propertyName, property);
    }
  }

  getIds() {
    const withoutPrefix = this.id.replace(DEVICE_PREFIX, '');
    const ids = withoutPrefix.split('-');
    return ids;
  }

  addModule(module) {
    const newProperties = {
      [`${module.id}-signal`]: {
        title: `${module.name} - Signal`,
        type: 'integer',
        unit: 'percent',
        minimum: 0,
        maximum: 100,
        multipleOf: 1,
        readOnly: true,
      },
      [`${module.id}-battery`]: {
        title: `${module.name} - Battery`,
        type: 'integer',
        unit: 'percent',
        minimum: 0,
        maximum: 100,
        multipleOf: 1,
        readOnly: true,
      },
    };

    for (const propertyName in newProperties) {
      const propertyDescription = newProperties[propertyName];
      const property = new ThermostatProperty(this, propertyName, propertyDescription);
      this.properties.set(propertyName, property);
    }
  }

  updateProperty(propertyName, value) {
    const property = this.findProperty(propertyName);
    if (property.value != value) {
      property.setCachedValue(value);
      this.notifyPropertyChanged(property);
    }
  }

  setRoomThermPoint(temp) {
    const [home_id, room_id] = this.getIds();
    return this.adapter.setRoomThermPoint(home_id, room_id, temp);
  }

  setThermostatMode(value) {
    const [home_id] = this.getIds();
    return this.adapter.setThermostatMode(home_id, value);
  }
}

class NetatmoEnergyAdapter extends Adapter {
  constructor(addonManager, manifest, reportError) {
    super(addonManager, 'NetatmoEnergyAdapter', manifest.id);
    const config = manifest.moziot.config;

    try {
      this.netatmo = new Netatmo(config);
    } catch(error) {
        console.warn(error);
        this.netatmo = undefined;
        reportError(packageName, "Netatmo API credentials are not valid. Please provide credentials in the add-on settings.");
        return;
    }

    addonManager.addAdapter(this);

    this.devices = {};
    this.moduleMapping = {};
    this.createDevices();

    setInterval(() => this.updateHomeData(), 5 * 60 * 1000);
    this.updateHomeData();
  }

  createDevices() {
    this.netatmo.homesData({}, async (error, data) => {
      if (error) {
        console.error(error);
        return;
      }

      data.homes.forEach((home) => {
        home.rooms.forEach((room) => {
          const id = `${home.id}-${room.id}`;
          this.devices[id] = new RoomDevice(this, `${DEVICE_PREFIX}${id}`, {
            '@type': ['Thermostat'],
            title: `${home.name} - ${room.name}`,
            description: `${home.name} - ${room.name}`,
            properties: {
              temperature: {
                '@type': 'TemperatureProperty',
                title: 'Current Temperature',
                type: 'number',
                unit: 'degree celsius',
                precision: 1,
                multipleOf: 0.5,
                readOnly: true,
              },
              targetTemperature: {
                '@type': 'TargetTemperatureProperty',
                title: 'Target Temperature',
                type: 'number',
                unit: 'degree celsius',
                precision: 1,
                multipleOf: 0.5,
              },
              heating: {
                '@type': 'HeatingCoolingProperty',
                title: 'Heating',
                type: 'string',
                readOnly: true,
              },
              mode: {
                '@type': 'ThermostatModeProperty',
                title: 'Mode',
                type: 'string',
                enum: ['auto', 'off'],
              },
            },
          });
        });

        home.modules.forEach((module) => {
          if (!AVAILABLE_TYPES.includes(module.type)) {
            return;
          }

          const deviceId = `${home.id}-${module.room_id}`;
          const roomDevice = this.devices[deviceId];

          if (roomDevice) {
            roomDevice.addModule(module);
            this.moduleMapping[module.id] = module.room_id;
          }
        });
      });

      for (const deviceId in this.devices) {
        this.handleDeviceAdded(this.devices[deviceId]);
      }
    });
  }

  updateHomeData() {
    this.netatmo.homesData({}, async (error, data) => {
      if (error) {
        console.error(error);
        return;
      }

      data.homes.forEach((home) => {
        this.netatmo.getHomeStatus({ home_id: home.id }, (error, data) => {
          if (error) {
            console.error(error);
            return;
          }

          data.home.rooms.forEach((room) => {
            const deviceId = `${home.id}-${room.id}`;
            const device = this.devices[deviceId];
            device.updateProperty('temperature', room.therm_measured_temperature);
            device.updateProperty('targetTemperature', room.therm_setpoint_temperature);
            device.updateProperty('heating', room.heating_power_request > 0 ? 'heating' : 'off');
          });

          data.home.modules.forEach((module) => {
            if (!AVAILABLE_TYPES.includes(module.type)) {
              return;
            }

            const deviceId = `${home.id}-${this.moduleMapping[module.id]}`;
            const device = this.devices[deviceId];
            device.updateProperty(`${module.id}-battery`, interpolateBattery(module.battery_level, module.type));
            device.updateProperty(`${module.id}-signal`, mapRfToPercent(module.rf_strength));
          });
        });
      });
    });
  }

  setRoomThermPoint(homeId, roomId, temp) {
    return new Promise((resolve, reject) => {
      this.netatmo.setRoomThermPoint({
        home_id: homeId,
        room_id: roomId,
        mode: 'manual',
        temp,
      }, (error) => {
        if (error) {
          return reject(error);
        }

        resolve(temp);
      });
    });
  }

  setThermostatMode(homeId, value) {
    const mode = value === 'off' ? 'away' : 'schedule';
    return new Promise((resolve, reject) => {
      this.netatmo.setThermMode({ home_id: homeId, mode }, (error) => {
        if (error) {
          return reject(error);
        }

        resolve(value);
      });
    });
  }
}

function clamp(num, max = 100, min = 0) {
  return Math.max(Math.min(num, max), min);
}

// Netatmo documents the expected good to bad ranges to be 30 units. However the strength
// can be reported as better than good, thus the value needs to be clamped.
function mapSignalToPercent(signal, min, range = 30) {
  return clamp(((min - signal) / range) * 90 + 10);
}

function mapRfToPercent(rf) {
  return mapSignalToPercent(rf, 90);
}

// Adapted from HomeAssistant
// https://github.com/home-assistant/core/blob/e32a57ce48c3ac778a5254bf244912081d9d654a/homeassistant/components/netatmo/climate.py#L526
function interpolateBattery(batteryLevel, moduleType) {
  // Make sure these are sorted
  const LEVELS = {
    NRV: {
      empty: 2200,
      low: 2200,
      medium: 2400,
      high: 2700,
      full: 3200,
    },
  };

  const steps = [20, 50, 80, 100];

  const levelDefinition = LEVELS[moduleType];
  const levels = Object.values(levelDefinition);

  if (batteryLevel >= levelDefinition['full']) {
    return 100;
  }

  let i = 0;
  if (batteryLevel >= levelDefinition['high']) {
    i = 3;
  } else if (batteryLevel >= levelDefinition['medium']) {
    i = 2;
  } else if (batteryLevel >= levelDefinition['low']) {
    i = 1;
  } else {
    return 0;
  }

  const pct = steps[i - 1] + (
    (steps[i] - steps[i - 1]) * (batteryLevel - levels[i]) / (levels[i + 1] - levels[i])
  );

  return Math.floor(pct);
}

module.exports = NetatmoEnergyAdapter;
