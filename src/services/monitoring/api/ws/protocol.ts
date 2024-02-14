import { EventEmitter } from 'node:events';

import { z } from 'zod';
import { FastifyRequest } from 'fastify';
import { SocketStream } from '@fastify/websocket';
import { ulid } from 'ulidx';

import { Logger } from '../../../types.js';
import {
  $QuerySubscription,
  QuerySubscription,
  XcmEventListener,
  XcmNotifyMessage,
  isXcmMatched,
  isXcmSent
} from '../../types.js';
import { Switchboard } from '../../switchboard.js';
import { TelemetryEventEmitter, notifyTelemetryFrom } from '../../../telemetry/types.js';
import { WebsocketProtocolOptions } from './plugin.js';
import { errorMessage } from '../../../../errors.js';

const jsonSchema = z.string().transform( ( str, ctx ) => {
  try {
    return {
      ...JSON.parse( str ),
      id: ulid(),
      ephemeral: true,
      channels: [{
        type: 'websocket'
      }]
    };
  } catch ( e ) {
    ctx.addIssue( { code: 'custom', message: 'Invalid JSON' } );
    return z.NEVER;
  }
} ).pipe($QuerySubscription);

type Connection = {
  id: string,
  ip: string,
  stream: SocketStream
}

function safeWrite(stream: SocketStream, content: Object) {
  return stream.writable
    ? stream.write(JSON.stringify(content))
    : false;
}

/**
 * Websockets subscription protocol.
 */
export default class WebsocketProtocol extends (EventEmitter as new () => TelemetryEventEmitter) {
  readonly #log: Logger;
  readonly #switchboard: Switchboard;
  readonly #broadcaster: XcmEventListener;
  readonly #maxClients: number;

  #connections: Map<string, Connection[]>;
  #clientsNum: number;

  constructor(
    log: Logger,
    switchboard: Switchboard,
    options: WebsocketProtocolOptions
  ) {
    super();

    this.#log = log;
    this.#switchboard = switchboard;

    this.#connections = new Map();
    this.#maxClients = options.wsMaxClients;
    this.#clientsNum = 0;
    this.#broadcaster = (sub, xcm) => {
      const connections = this.#connections.get(sub.id);
      if (connections) {
        for (const connection of connections) {
          const {stream, ip} = connection;
          try {
            safeWrite(stream, xcm);

            this.#telemetryNotify(ip, xcm)
          } catch (error) {
            this.#log.error(error);

            this.#telemetryNotifyError(ip, xcm, errorMessage(error));
          }
        }
      }
    };

    this.#switchboard.addNotificationListener('websocket', this.#broadcaster);
  }

  /**
   * Handles incoming connections.
   *
   * If no subscription is given creates an ephemeral through the websocket.
   *
   * @param stream The websocket stream
   * @param request The Fastify request
   * @param subscriptionId The subscription identifier
   */
  async handle(
    stream: SocketStream,
    request: FastifyRequest,
    subscriptionId?: string
  ) {
    if (this.#clientsNum >= this.#maxClients) {
      stream.socket.close(1013, 'server too busy');
      return;
    }

    try {
      if (subscriptionId === undefined) {
        let resolvedId : string;

        // on-demand ephemeral subscriptions
        stream.on('data', (data: Buffer) => {
          setImmediate(async () => {
            if (resolvedId) {
              safeWrite(stream, { id: resolvedId });
            } else {
              const parsed = jsonSchema.safeParse(data.toString());
              if (parsed.success) {
                const onDemandSub = parsed.data;
                try {
                  this.#addSubscriber(onDemandSub, stream, request);
                  resolvedId = onDemandSub.id;
                  await this.#switchboard.subscribe(onDemandSub);
                  safeWrite(stream, onDemandSub);
                } catch (error) {
                  stream.socket.close(1013, 'server too busy');
                  this.#log.error(error);
                }
              } else {
                safeWrite(stream, parsed.error);
              }
            }});
        });
      } else {
        // existing subscriptions
        const handler = this.#switchboard.findSubscriptionHandler(subscriptionId);
        if (handler === undefined) {
          throw new Error('subscription not found');
        }

        const subscription = handler.descriptor;
        this.#addSubscriber(subscription, stream, request);
      }
    } catch (error) {
      stream.socket.close(1007, errorMessage(error));
    }
  }

  stop() {
    this.#switchboard.removeNotificationListener(
      'websocket', this.#broadcaster
    );
  }

  #addSubscriber(
    subscription: QuerySubscription,
    stream: SocketStream,
    request: FastifyRequest
  ) {
    if (subscription.channels.findIndex(
      chan => chan.type === 'websocket'
    ) === -1) {
      throw new Error(
        'websocket channel not enabled in subscription'
      );
    }

    this.#clientsNum++;

    const subId = subscription.id;
    const connection = {
      id: request.id, ip: request.ip, stream
    };

    if (this.#connections.has(subId)) {
      this.#connections.get(subId)?.push(connection);
    } else {
      this.#connections.set(subId, [connection]);
    }

    this.emit('telemetrySocketListener', request.ip, subscription);

    stream.socket.once('close', async () => {
      this.#clientsNum--;

      const { id, ephemeral } = subscription;

      try {
        if (ephemeral) {
          // TODO clean up pending matches
          await this.#switchboard.unsubscribe(id);
        }

        this.emit('telemetrySocketListener', request.ip, subscription, true);
      } catch (error) {
        this.#log.error(error);
      } finally {
        // TODO: check if frees memory
        const connections = this.#connections.get(id);
        if (connections) {
          const index = connections.findIndex(c => c.id === request.id);
          if (index > -1) {
            connections.splice(index, 1);
          }
          if (connections.length === 0) {
            this.#connections.delete(id);
          }
        }
      }
    });
  }

  #telemetryNotify(
    ip: string,
    xcm: XcmNotifyMessage
  ) {
    if(isXcmMatched(xcm)) {
      this.emit('telemetryNotify', notifyTelemetryFrom(
        'websocket', ip, xcm
      ));
    } else {
      console.log(`XCM ${xcm.type} telemetryNotify not implemented.`);
    }
  }

  #telemetryNotifyError(
    ip: string,
    xcm: XcmNotifyMessage,
    errorMessage: string
  ) {
    if(isXcmMatched(xcm)) {
      this.emit('telemetryNotifyError', notifyTelemetryFrom(
        'websocket', ip, xcm, errorMessage
      ));
    } else {
      console.log(`XCM ${xcm.type} telemetryNotifyError not implemented.`);
    }
  }

  #telemetryNotify(
    ip: string,
    xcm: XcmNotifyMessage
  ) {
    if(isXcmMatched(xcm)) {
      this.emit('telemetryNotify', notifyTelemetryFrom(
        'websocket', ip, xcm
      ));
    } else {
      console.log(`XCM ${xcm.type} telemetryNotify not implemented.`);
    }
  }

  #telemetryNotifyError(
    ip: string,
    xcm: XcmNotifyMessage,
    errorMessage: string
  ) {
    if(isXcmMatched(xcm)) {
      this.emit('telemetryNotifyError', notifyTelemetryFrom(
        'websocket', ip, xcm, errorMessage
      ));
    } else {
      console.log(`XCM ${xcm.type} telemetryNotifyError not implemented.`);
    }
  }
}