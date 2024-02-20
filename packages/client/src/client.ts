import { WebSocket, type MessageEvent } from 'isows';

import type { OnDemandQuerySubscription } from './types';
import type { QuerySubscription, XcmNotifyMessage } from './server-types';

/**
 * The Ocelloids client configuration.
 *
 * @public
 */
export type OcelloidsClientConfig = {
  wsUrl: string;
  httpUrl: string;
  httpAuthToken?: string;
  wsAuthToken?: string;
}

/**
 * Type guard to check if a value is a Blob.
 *
 * @param value - The value to check.
 * @returns whether the value is a Blob.
 */
function isBlob(value: any): value is Blob {
  if (typeof Blob === 'undefined') {
    return false;
  }
  return value instanceof Blob || Object.prototype.toString.call(value) === '[object Blob]';
}

/**
 * @public
 */
export type MessageHandler<T> = (message: T, ws: WebSocket, event: MessageEvent) => void;

/**
 * @public
 */
export type CloseHandler = (event: CloseEvent) => void;

/**
 * @public
 */
export type ErrorHandler = (error: Event) => void;

/**
 * Type definition for WebSocket event handlers.
 *
 * @public
 */
export type WebSocketHandlers = {
  onMessage: MessageHandler<XcmNotifyMessage>,
  onClose?: CloseHandler,
  onError?: ErrorHandler
}

/**
 * Protocol class to chain request response until reach streaming state.
 */
class Protocol {
  readonly #queue : MessageHandler<any>[] = new Array();
  readonly #stream: MessageHandler<XcmNotifyMessage>;
  #isStreaming: boolean;

  /**
   * Constructs a Protocol instance.
   * @param stream - The message handler for streaming state.
   */
  constructor(stream: MessageHandler<XcmNotifyMessage>) {
    this.#stream = stream;
    this.#isStreaming = false;
  }

  /**
   * Adds a handler to the message queue.
   * @template T - The type of the message.
   * @param handler - The message handler to add.
   */
  next<T>(handler: MessageHandler<T>) {
    this.#queue.push(handler);
  }

  /**
   * Handles a WebSocket message event.
   * @param event - The message event to handle.
   */
  handle(event: MessageEvent) {
    const ws = event.target as WebSocket;
    let current: MessageHandler<any>;

    if (this.#isStreaming) {
      current = this.#stream;
    } else {
      const next = this.#queue.pop();
      if (next) {
        current = next;
      } else {
        current = this.#stream;
        this.#isStreaming = true;
      }
    }

    if (isBlob(event.data)) {
      (event.data as Blob).text().then(
        blob => current(JSON.parse(blob), ws, event)
      );
    } else {
      current(JSON.parse(event.data.toString()), ws, event);
    }
  }
}

/**
 * The Ocelloids client.
 *
 * @public
 */
export class OcelloidsClient {
  readonly #config: OcelloidsClientConfig;
  readonly #headers: {};

  /**
   * Constructs an OcelloidsClient instance.
   *
   * @param config - The configuration for the client.
   */
  constructor(config: OcelloidsClientConfig) {
    this.#config = config;

    const headers : Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    if (config.httpAuthToken) {
      headers['Authorization'] = `Bearer ${config.httpAuthToken}`;
    }

    this.#headers = headers;
  }

  /**
   * Creates a subscription.
   *
   * @param subscription - The subscription to create.
   * @returns A promise that resolves when the subscription is created.
   */
  async create(subscription: QuerySubscription) {
    return new Promise<void>(async (resolve, reject) => {
      const res = await fetch(this.#config.httpUrl + '/subs', {
        method: 'POST',
        headers: this.#headers,
        body: JSON.stringify(subscription),
      });

      if (res.ok) {
        resolve();
      } else {
        reject(await res.json());
      }
    });
  }

  /**
   * Gets a subscription by its identifier.
   *
   * @param subscriptionId - The subscription identifier.
   * @returns A promise that resolves with the subscription or rejects if not found.
   */
  async get(subscriptionId: string)
  : Promise<QuerySubscription> {
    return new Promise<QuerySubscription>(async (resolve, reject) => {
      const res = await fetch(this.#config.httpUrl + '/subs/' + subscriptionId);
      if (res.ok) {
        resolve((await res.json()) as QuerySubscription);
      } else {
        reject(await res.json());
      }
    });
  }

  /**
   * Checks the health of the service.
   *
   * @returns A promise that resolves with the health status.
   */
  async health() {
    return new Promise(async (resolve, reject) => {
      const res = await fetch(this.#config.httpUrl + '/health');
      if (res.ok) {
        resolve(await res.json());
      } else {
        reject(await res.text());
      }
    });
  }

  /**
   * Creates an on-demand subscription or connects to an existing one.
   *
   * @param subscription - The subscription id or the subscription object to create.
   * @param handlers - The WebSocket event handlers.
   * @returns A promise that resolves with the WebSocket instance.
   */
  async subscribe(
    subscription: string | OnDemandQuerySubscription,
    handlers: WebSocketHandlers
  ): Promise<WebSocket> {
    const url = this.#config.wsUrl + '/ws/subs';

    return typeof subscription === 'string'
      ? this.#openWebSocket(`${url}/${subscription}`, handlers)
      : this.#openWebSocket(url, handlers, subscription);
  }

  #openWebSocket(
    url: string,
    { onMessage, onError, onClose }: WebSocketHandlers,
    sub?: OnDemandQuerySubscription
  ) {
    return new Promise<WebSocket>((resolve, reject) => {
      const protocol = new Protocol(onMessage);
      const ws = new WebSocket(url);

      ws.onmessage = protocol.handle.bind(protocol);

      if (onError) {
        ws.onerror = onError;
      }

      if (onClose) {
        ws.onclose = onClose;
      }

      function requestOnDemandSub() {
        ws.send(JSON.stringify(sub));
        protocol.next<QuerySubscription>(msg => {
          // TODO add callback?
          // TODO handle failure...
          console.log('> subscription', msg);
        });
      }

      ws.onopen = () => {
        if (ws.readyState === 1) {
          if (this.#config.wsAuthToken) {
            ws.send(this.#config.wsAuthToken);
            protocol.next(() => {
              // note that will error if auth fails
              if (sub) {
                requestOnDemandSub();
              }
            });
          } else if (sub) {
            requestOnDemandSub();
          }

          resolve(ws);
        } else {
          reject('ws ready state: ' + ws.readyState);
        }
      };
    });
  }
}