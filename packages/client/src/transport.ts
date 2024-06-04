import { WebSocket } from 'isows'

import {
  AnySubscriptionInputs,
  AuthReply,
  OcelloidsClientConfig,
  OnDemandSubscriptionHandlers,
  Subscription,
  SubscriptionError,
  WebSocketHandlers,
  WsAuthErrorEvent,
  isSubscription,
  isSubscriptionError,
} from './lib'
import { Protocol } from './protocol'

/**
 * Returns HTTP headers from configuration.
 *
 * @private
 */
function headersFromConfig(config: OcelloidsClientConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  if (config.httpAuthToken) {
    headers['Authorization'] = `Bearer ${config.httpAuthToken}`
  }
  return headers
}

/**
 * Curried fetch function.
 */
export type FetchFn = <T>(url: string, init?: RequestInit | undefined) => Promise<T>

/**
 * Returns a {@link FetchFn} from the given config.
 */
export function doFetchWithConfig<T>(config: OcelloidsClientConfig) {
  const headers = headersFromConfig(config)
  return (url: string, init?: RequestInit) => doFetch<T>(headers, url, init)
}

/**
 * HTTP transport.
 *
 * @param headers
 * @param url
 * @param init
 */
export function doFetch<T>(headers: Record<string, string>, url: string, init?: RequestInit) {
  return new Promise<T>((resolve, reject) => {
    fetch(url, {
      headers,
      ...init,
    })
      .then((res) => {
        if (res.ok) {
          res.json().then((j) => {
            resolve(j as T)
          })
        } else {
          res
            .json()
            .then(reject)
            .catch((_) => {
              if (res.body === null || res.body.locked) {
                reject({
                  status: res.status,
                  statusText: res.statusText,
                })
              } else {
                res.text().then(reject)
              }
            })
        }
      })
      .catch(reject)
  })
}

type OnDemandWithAgent<T = AnySubscriptionInputs> = {
  agent: string
  args: T
  ephemeral: boolean
}

/**
 * WebSocket transport.
 *
 * @param config
 * @param url
 * @param wsHandlers
 * @param onDemandSub
 * @returns
 */
export function openWebSocket<T = AnySubscriptionInputs>(
  config: OcelloidsClientConfig,
  url: string,
  { onMessage, onAuthError, onError, onClose }: WebSocketHandlers,
  onDemandSub?: {
    sub: OnDemandWithAgent<T>
    onDemandHandlers?: OnDemandSubscriptionHandlers
  }
) {
  const protocol = new Protocol(onMessage)
  const ws = new WebSocket(url)

  ws.onmessage = protocol.handle.bind(protocol)

  if (onError) {
    ws.onerror = onError
  }

  if (onClose) {
    ws.onclose = onClose
  }

  function requestOnDemandSub() {
    if (onDemandSub === undefined) {
      throw new Error('on demand subscription must be defined')
    }
    const { sub, onDemandHandlers } = onDemandSub

    ws.send(JSON.stringify(sub))

    protocol.next<Subscription | SubscriptionError>((msg) => {
      if (onDemandHandlers?.onSubscriptionCreated && isSubscription(msg)) {
        onDemandHandlers.onSubscriptionCreated(msg)
      } else if (onDemandHandlers?.onSubscriptionError && isSubscriptionError(msg)) {
        onDemandHandlers.onSubscriptionError(msg)
      } else if (onDemandHandlers?.onError) {
        onDemandHandlers.onError(msg)
      }
    })
  }

  ws.onopen = () => {
    if (ws.readyState !== 1) {
      ws.dispatchEvent(new Event('error'))
      return
    }

    if (config.wsAuthToken) {
      ws.send(config.wsAuthToken)
      protocol.next<AuthReply>((reply, _ws, event) => {
        if (reply.error) {
          if (onAuthError) {
            onAuthError(reply, _ws, event)
          } else {
            _ws.dispatchEvent(new WsAuthErrorEvent(reply))
          }
        } else if (onDemandSub) {
          requestOnDemandSub()
        }
      })
    } else if (onDemandSub) {
      requestOnDemandSub()
    }
  }

  return ws
}
