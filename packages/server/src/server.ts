import process from 'node:process'

import { z } from 'zod'

import closeWithGrace from 'close-with-grace'
import Fastify from 'fastify'

import FastifyCors from '@fastify/cors'
import FastifySwagger from '@fastify/swagger'
import FastifySwaggerUI from '@fastify/swagger-ui'
import FastifyWebsocket from '@fastify/websocket'
import FastifyHealthcheck from 'fastify-healthcheck'

import { logger } from './environment.js'
import { errorHandler } from './errors.js'
import {
  Administration,
  Agents,
  Auth,
  Configuration,
  Connector,
  Ingress,
  Limit,
  Persistence,
  Root,
  Subscriptions,
  Telemetry,
} from './services/index.js'
import version from './version.js'

import { toCorsOpts } from './cli/args.js'
import {
  $AgentCatalogOptions,
  $BaseServerOptions,
  $ConfigServerOptions,
  $CorsServerOptions,
  $LevelServerOptions,
  $RedisServerOptions,
  $SubscriptionServerOptions,
} from './types.js'

const WS_MAX_PAYLOAD = 1048576 // 1MB

export const $ServerOptions = z
  .object({
    distributed: z.boolean().default(false),
  })
  .merge($BaseServerOptions)
  .merge($CorsServerOptions)
  .merge($SubscriptionServerOptions)
  .merge($ConfigServerOptions)
  .merge($LevelServerOptions)
  .merge($RedisServerOptions)
  .merge($AgentCatalogOptions)

type ServerOptions = z.infer<typeof $ServerOptions>

/**
 * Creates and starts the Ocelloids Execution Server with specified options.
 *
 * @param {ServerOptions} opts - Options for configuring the server.
 */
export async function createServer(opts: ServerOptions) {
  const server = Fastify({
    logger,
  })

  server.setErrorHandler(errorHandler)

  /* istanbul ignore next */
  const closeListeners = closeWithGrace(
    {
      delay: opts.grace,
    },
    async function ({ err }) {
      if (err) {
        server.log.error(err)
      }

      const { websocketServer } = server
      if (websocketServer.clients) {
        server.log.info('Closing websockets')

        for (const client of websocketServer.clients) {
          client.close(1001, 'server shutdown')
          if (client.readyState !== client.CLOSED) {
            // Websocket clients could ignore the close acknowledge
            // breaking the clean shutdown of the server.
            // To prevent it we terminate the socket.
            client.terminate()
          }
        }
      }

      await server.close()
    },
  )

  /* istanbul ignore next */
  process.once('SIGUSR2', async function () {
    await server.close()
    // Controlled shutdown for Nodemon
    // https://github.com/remy/nodemon?tab=readme-ov-file#controlling-shutdown-of-your-script
    process.kill(process.pid, 'SIGUSR2')
  })

  server.addHook('onClose', function (_, done) {
    closeListeners.uninstall()
    done()
  })

  await server.register(FastifySwagger, {
    openapi: {
      info: {
        title: 'Ocelloids Execution Node',
        version,
      },
    },
  })

  await server.register(FastifySwaggerUI, {
    routePrefix: '/documentation',
  })

  await server.register(FastifyHealthcheck, {
    exposeUptime: true,
  })

  await server.register(FastifyWebsocket, {
    options: {
      // we don't need to negotiate subprotocols
      handleProtocols: undefined,
      maxPayload: WS_MAX_PAYLOAD,
      perMessageDeflate: false,
      // https://elixir.bootlin.com/linux/v4.15.18/source/Documentation/networking/ip-sysctl.txt#L372
      // backlog: 511 // # default
    },
    // override default pre-close
    // we explicitly handle it with terminate
    preClose: () => {
      /* empty */
    },
  })

  if (opts.cors) {
    server.log.info('Enable CORS')

    const corsOpts = toCorsOpts(opts)
    server.log.info('- origin: %s', corsOpts.origin)
    server.log.info('- credentials: %s', corsOpts.credentials)

    await server.register(FastifyCors, corsOpts)
  }

  await server.register(Limit, opts)
  await server.register(Auth)
  await server.register(Root)

  if (!opts.distributed) {
    await server.register(Configuration, opts)
    await server.register(Connector)
  }

  await server.register(Persistence, opts)
  await server.register(Ingress, opts)
  await server.register(Agents, opts)
  await server.register(Subscriptions, opts)
  await server.register(Administration)
  await server.register(Telemetry, opts)

  return server
}
