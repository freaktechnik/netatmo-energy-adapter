'use strict';

const NetatmoEnergyAdapter = require('./netatmo-energy-adapter');

module.exports = (addonManager, manifest, reportError) => {
  new NetatmoEnergyAdapter(addonManager, manifest, reportError);
};
