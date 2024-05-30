import { EventEmitter } from 'node:events'

import got from 'got'
import { ulid } from 'ulidx'

import version from '../../version.js'
import { Subscription, WebhookNotification } from '../subscriptions/types.js'
import { Logger, Services } from '../types.js'

import { Scheduled, Scheduler, SubsStore } from '../persistence/index.js'
import { notifyTelemetryFrom } from '../telemetry/types.js'
import { NotifierHub } from './hub.js'
import { TemplateRenderer } from './template.js'
import { Notifier, NotifierEmitter, NotifyMessage } from './types.js'

const DEFAULT_DELAY = 300000 // 5 minutes

type WebhookTask = {
  id: string
  subId: string
  agentId: string
  msg: NotifyMessage
}
const WebhookTaskType = 'task:webhook'

function buildPostUrl(url: string, id: string) {
  return [url, id].join('/').replace(/([^:]\/)\/+/g, '$1')
}

/**
 * WebhookNotifier ensures reliable delivery of webhook notifications.
 *
 * Features:
 * - Immediate and scheduled retry logic.
 * - Text templates for the body payload.
 */
export class WebhookNotifier extends (EventEmitter as new () => NotifierEmitter) implements Notifier {
  #log: Logger
  #scheduler: Scheduler
  #subs: SubsStore
  #renderer: TemplateRenderer

  constructor(hub: NotifierHub, { log, scheduler, subsStore }: Services) {
    super()

    this.#log = log
    this.#scheduler = scheduler
    this.#subs = subsStore
    this.#renderer = new TemplateRenderer()

    this.#scheduler.on(WebhookTaskType, this.#dispatch.bind(this))

    hub.on('webhook', this.notify.bind(this))
  }

  async notify(sub: Subscription, msg: NotifyMessage) {
    const { id, agent, channels } = sub

    for (const chan of channels) {
      if (chan.type === 'webhook') {
        const taskId = ulid()
        const scheduled: Scheduled<WebhookTask> = {
          type: WebhookTaskType,
          task: {
            id: taskId,
            subId: id,
            agentId: agent,
            msg,
          },
        }
        await this.#dispatch(scheduled)
      }
    }
  }

  async #dispatch(scheduled: Scheduled<WebhookTask>) {
    const {
      task: { subId, agentId },
    } = scheduled

    try {
      const { channels } = await this.#subs.getById(agentId, subId)
      for (const chan of channels) {
        if (chan.type === 'webhook') {
          const config = chan as WebhookNotification
          await this.#post(scheduled, config)
        }
      }
    } catch (error) {
      // do not re-schedule
      this.#log.error(error, 'Webhook dispatch error')
    }
  }

  async #post(scheduled: Scheduled<WebhookTask>, config: WebhookNotification) {
    const {
      task: { id, msg },
    } = scheduled
    const { contentType, url, limit, template } = config
    const postUrl = buildPostUrl(url, id)

    try {
      const res = await got.post<NotifyMessage>(postUrl, {
        body: template === undefined ? JSON.stringify(msg) : this.#renderer.render({ template, data: msg }),
        headers: {
          'user-agent': 'ocelloids/' + version,
          'content-type': contentType ?? 'application/json',
        },
        retry: {
          limit: limit ?? 5,
          methods: ['POST'],
        },
        context: {
          bearer: config.bearer,
        },
        hooks: {
          init: [
            (raw, options) => {
              if ('bearer' in raw) {
                options.context.bearer = raw.bearer
                delete raw.bearer
              }
            },
          ],
          beforeRequest: [
            (options) => {
              const { bearer } = options.context
              if (bearer && !options.headers.authorization) {
                options.headers.authorization = `Bearer ${bearer}`
              }
            },
          ],
        },
      })

      if (res.statusCode >= 200 && res.statusCode < 300) {
        this.#log.info(
          'NOTIFICATION %s agent=%s subscription=%s, endpoint=%s',
          msg.metadata.type,
          msg.metadata.agentId,
          msg.metadata.subscriptionId,
          postUrl
        )
        this.#telemetryNotify(config, msg)
      } else {
        // Should not enter here, since the non success status codes
        // are retryable and will throw an exception when the limit
        // of retries is reached.
        this.#log.error('Not deliverable webhook %s %s', postUrl, id)
      }
    } catch (error) {
      this.#log.warn(error, 'Error while posting to webhook %s', config.url)

      // Re-schedule in 5 minutes
      const time = new Date(Date.now() + DEFAULT_DELAY)
      const key = time.toISOString() + id
      await this.#scheduler.schedule({
        ...scheduled,
        key,
      })
      this.#log.info('Scheduled webhook delivery %s', key)
      this.#telemetryNotifyError(config, msg)
    }
  }

  #telemetryNotify(config: WebhookNotification, msg: NotifyMessage) {
    this.emit('telemetryNotify', notifyTelemetryFrom(config.type, config.url, msg))
  }

  #telemetryNotifyError(config: WebhookNotification, msg: NotifyMessage) {
    this.emit('telemetryNotifyError', notifyTelemetryFrom(config.type, config.url, msg, 'max_retries'))
  }
}
