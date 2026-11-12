'use strict';

const { createPublicSearchProvider } = require('./public-search.cjs');

async function createProviders(options = {}) {
  const providers = new Map();
  providers.set('netease', createPublicSearchProvider('netease', options));
  providers.set('qq', createPublicSearchProvider('qq', options));
  try {
    const { createQishuiProvider } = require('./qishui.cjs');
    const qishui = await createQishuiProvider(options);
    providers.set('qishui', qishui);
  } catch (error) {
    if (options.onError) options.onError(error);
  }
  return providers;
}

module.exports = { createProviders };
