/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

'use strict';

const { Database } = require('gateway-addon');

module.exports = {
  addToConfig,
};

async function addToConfig(packageName, config) {
  try {
    const database = new Database(packageName);
    await database.open();

    const existingConfig = await database.loadConfig();
    const mergedConfig = {
      ...existingConfig,
      ...config,
    };

    await database.saveConfig(mergedConfig);
    await database.close();
  } catch (error) {
    console.error('SAVING_CONFIG_FAILED', error);
  }
}
