'use strict';

const { createQishuiProvider } = require('./qishui.cjs');

async function createProviders(options = {}) {
  const providers = new Map();
  const qishui = await createQishuiProvider(options);
  providers.set('qishui', qishui);
  return providers;
}

module.exports = { createProviders };
