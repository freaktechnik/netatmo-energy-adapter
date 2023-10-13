/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

'use strict';

const fetch = require('node-fetch');

const { addToConfig } = require('./config');

class Netatmo {
  constructor(config, packageName) {
    this.config = config;
    this.packageName = packageName;

    if (this.config.refresh_token) {
      this.initRefresh();
    }
  }

  initRefresh() {
    const expiresIn = (this.config.expires || Date.now()) - Date.now();
    if (expiresIn > 0 && this.config.token) {
      console.log('Token still valid for:', expiresIn);
      this.refreshInterval = setTimeout(() => this.refresh(), expiresIn);
    } else {
      this.refresh();
    }
  }

  updateConfig() {
    return addToConfig(this.packageName, {
      expires: this.config.expires,
      refresh_token: this.config.refresh_token,
    });
  }

  async refresh() {
    console.log('Starting token refresh');
    delete this.refreshInterval;
    this.config.token = '';

    if (!this.config.refresh_token) {
      console.error('Can not refresh token.');
      return;
    }

    console.log('Refreshing netatmo token using existing refresh token.');
    const body = new URLSearchParams();
    body.append('grant_type', 'refresh_token');
    body.append('refresh_token', this.config.refresh_token);
    body.append('client_id', this.config.client_id);
    body.append('client_secret', this.config.client_secret);

    const response = await fetch('https://api.netatmo.com/oauth2/token', {
      method: 'POST',
      body,
    });

    if (!response.ok || response.status !== 200) {
      console.error('Failed to refresh token.');
      this.config.token = '';
      this.config.refresh_token = '';
      await this.updateConfig();
      return;
    }

    const data = await response.json();
    this.config.token = data.access_token;
    this.config.expires = Date.now() + (data.expires_in * 1000);
    this.config.refresh_token = data.refresh_token;
    console.log('Refreshed token until:', new Date(this.config.expires).toISOString());
    await this.updateConfig();

    this.initRefresh();
  }

  get needsAuth() {
    return !this.config.refresh_token;
  }

  unInit() {
    if (this.refreshInterval) {
      clearTimeout(this.refreshInterval);
    }
  }

  async* authenticate(scopes, redirectUri) {
    const state = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16);
    const data = yield `https://api.netatmo.com/oauth2/authorize?client_id=${this.config.client_id}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes.join('+')}&state=${encodeURIComponent(state)}`;

    if (!data.state || data.state !== state || !data.code) {
      throw new Error(`Authentication flow failed. Possible error: ${data.error}`);
    }

    const body = new URLSearchParams();
    body.append('scope', scopes.join(' '));
    body.append('code', data.code);
    body.append('grant_type', 'authorization_code');
    body.append('client_id', this.config.client_id);
    body.append('client_secret', this.config.client_secret);
    body.append('redirect_uri', redirectUri);

    const response = await fetch(`https://api.netatmo.com/oauth2/token`, {
      method: 'POST',
      body,
    });

    if (!response.ok || response.status !== 200) {
      throw new Error('Authentication flow failed while retrieving token.');
    }

    const tokenData = await response.json();
    this.config.expires = Date.now() + (tokenData.expires_in * 1000);
    this.config.token = tokenData.access_token;
    this.config.refresh_token = tokenData.refresh_token;
    await this.updateConfig();

    this.initRefresh();
  }

  async getHomeData(homeId) {
    if (!this.config.token) {
      throw new Error("No token found");
    }

    const body = new URLSearchParams();

    if (homeId) {
      body.append('home_id', homeId);
    }

    const response = await fetch('https://api.netatmo.com/api/homesdata', {
      method: 'POST',
      body,
      headers: {
        Authorization: `Bearer ${this.config.token}`
      }
    });

    console.log('Got response for Home Data', response.ok, response.status);
    if (!response.ok || response.status !== 200) {
      if (response.status === 403) {
        this.config.token = '';
        this.refresh();
        throw new Error('Unauthorized');
      }

      return [];
    }

    const data = await response.json();

    if (!Array.isArray(data.body.homes)) {
      return [];
    }

    return data.body.homes;
  }

  async getHomeStatus(homeId) {
    if (!this.config.token) {
      throw new Error("No token found");
    }

    const body = new URLSearchParams();

    if (homeId) {
      body.append('home_id', homeId);
    }

    const response = await fetch('https://api.netatmo.com/api/homestatus', {
      method: 'POST',
      body,
      headers: {
        Authorization: `Bearer ${this.config.token}`
      }
    });

    console.log('Got response for Home Status', response.ok, response.status);
    if (!response.ok || response.status !== 200) {
      if (response.status === 403) {
        this.config.token = '';
        this.refresh();
        throw new Error('Unauthorized');
      }

      return [];
    }

    const data = await response.json();

    return data.body.home;
  }

  async setRoomThermPoint({ homeId, roomId, mode, temp }) {
    if (!this.config.token) {
      throw new Error("No token found");
    }

    const body = new URLSearchParams();

    if (homeId) {
      body.append('home_id', homeId);
    }

    if (roomId) {
      body.append('room_id', roomId);
    }

    if (mode) {
      body.append('mode', mode);
    }

    if (temp) {
      body.append('temp', temp);
    }

    const response = await fetch('https://api.netatmo.com/api/setroomthermpoint', {
      method: 'POST',
      body,
      headers: {
        Authorization: `Bearer ${this.config.token}`
      }
    });

    console.log('Got response for Set Room Therm Point', response.ok, response.status);
    if (!response.ok || response.status !== 200) {
      if (response.status === 403) {
        this.config.token = '';
        this.refresh();
        throw new Error('Unauthorized');
      }

      return [];
    }

    const data = await response.json();

    return data.body;
  }

  async setThermostatMode({ homeId, mode }) {
    if (!this.config.token) {
      throw new Error("No token found");
    }

    const body = new URLSearchParams();

    if (homeId) {
      body.append('home_id', homeId);
    }

    if (mode) {
      body.append('mode', mode);
    }

    const response = await fetch('https://api.netatmo.com/api/setthermmode', {
      method: 'POST',
      body,
      headers: {
        Authorization: `Bearer ${this.config.token}`
      }
    });

    console.log('Got response for Set Therm Mode', response.ok, response.status);
    if (!response.ok || response.status !== 200) {
      if (response.status === 403) {
        this.config.token = '';
        this.refresh();
        throw new Error('Unauthorized');
      }

      return [];
    }

    const data = await response.json();

    return data.body;
  }
}

module.exports = Netatmo;
