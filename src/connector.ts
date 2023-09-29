
import fs from 'node:fs';

import { ProviderInterface } from '@polkadot/rpc-provider/types';
import { WsProvider } from '@polkadot/api';
import { ScProvider } from '@polkadot/rpc-provider/substrate-connect';
import * as Sc from '@substrate/connect';
import { config as oconfig, SubstrateApis } from '@sodazone/ocelloids';

import { NetworkConfiguration } from './configuration.js';
import { ServiceContext } from './context.js';
import { DefaultSubstrateApis } from 'types.js';

/**
 *
 */
export default class Connector {
  #relays: Record<string, ScProvider> = {};
  #chains: Record<string, ProviderInterface> = {};
  #chainIdMap: Record<string, number> = {};
  #substrateApis?: DefaultSubstrateApis;
  #ctx: ServiceContext;

  constructor(ctx: ServiceContext) {
    this.#ctx = ctx;

    const { config: { networks } } = ctx;

    for (const network of networks) {
      if (this.#chains[network.name] !== undefined) {
        continue;
      }

      ctx.log.info(`Register network: ${network.name} [chainId=${network.id}]`);

      this.#chainIdMap[network.name] = network.id;
      this.registerNetwork(network);
    }
  }

  private registerNetwork(network: NetworkConfiguration) {
    switch (network.provider.type) {
    case 'rpc':
      if (network.provider.url) {
        this.#chains[network.name] = new WsProvider(network.provider.url);
      } else {
        throw new Error(
          `Please provide a web socket endpoint for ${network.name}`
        );
      }
      break;
    case 'smoldot':
      if (network.relay) {
        if (this.#relays[network.relay] === undefined) {
          const key = Object.values(Sc.WellKnownChain).find(c => c === network.relay);
          if (key) {
            this.#ctx.log.info(`Register relay: ${key}`);
            this.#relays[network.relay] = new ScProvider(
              Sc, Sc.WellKnownChain[key]
            );
          } else {
            this.#ctx.log.error(
              `Unknown relay network ${network.relay}.\nKnown networks ${Object.values(Sc.WellKnownChain)}`
            );
          }
        }

        this.#chains[network.name] = new ScProvider(Sc,
          // TODO: handle local and absolute locations
          fs.readFileSync(new URL(network.provider.spec!, import.meta.url), 'utf-8'),
          this.#relays[network.relay]
        );
      } else {
        // A Smoldot relay client
        this.#ctx.log.info(`Register relay: ${network.name}`);
        this.#relays[network.name] = new ScProvider(Sc,
          fs.readFileSync(new URL(network.provider.spec!, import.meta.url), 'utf-8')
        );
      }
      break;
    default:
      throw new Error(`Unsupported provider type ${network.provider.type}`);
    }
  }

  connect() {
    if (this.#substrateApis) {
      return this.#substrateApis;
    }

    const providers: oconfig.Configuration = {};

    for (const key of Object.keys(this.#relays)) {
      const provider = this.#relays[key];
      providers[this.#chainIdMap[key]] = {provider};
      provider.connect().catch(
        this.#ctx.log.error.bind(this.#ctx.log)
      );
    }

    for (const key of Object.keys(this.#chains)) {
      const provider = this.#chains[key];
      providers[this.#chainIdMap[key]] = {provider};
      if (provider instanceof ScProvider) {
        provider.connect().catch(
          this.#ctx.log.error.bind(this.#ctx.log)
        );
      }
    }

    // Providers are exposed by chain id.
    this.#substrateApis = new SubstrateApis(providers);
    return this.#substrateApis;
  }

  disconnect() {
    if (this.#substrateApis) {
      this.#substrateApis.disconnect();
    }
  }
}