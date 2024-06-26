# Observability with Prometheus

The Ocelloids Service Node emits metrics related to subscriptions, notifications, XCM activity, and ingress. This guide will walk you through the process of setting up Prometheus to collect these metrics and Grafana to display them conveniently on a dashboard.

## Running

> [!IMPORTANT]
> We are mapping `host.docker.internal:host-gateway` in the docker compose "extra_hosts".
> If you experience problems connecting from the container to the local host, just remove the "extra_hosts" configuration in the `docker-compose.yml`.
> More info: https://docs.docker.com/desktop/networking/#i-want-to-connect-from-a-container-to-a-service-on-the-host

We've provided an example [Docker Compose](https://github.com/sodazone/ocelloids-services/tree/main/packages/server/guides/telemetry/docker-compose.yml) file and sample configurations in the `telemetry` directory to help you set up Prometheus, Grafana, and Alertmanager.

To start, navigate to the directory containing the Docker Compose file:

```shell
# from project root
cd packages/server/guides/telemetry
```

Then run:

```shell
docker compose up
```

## Grafana

Once the services are up and running, you can access Grafana at [http://localhost:3001](http://localhost:3001). On your first access, you'll be prompted to log in. Provide the username and password set in [`config.monitoring`](https://github.com/sodazone/ocelloids-services/tree/main/packages/server/guides/telemetry/grafana/config.monitoring).

Now you can run metric queries and start building your dashboards. All metrics exposed by the Ocelloids Service Node are prefixed with `oc_` in the metric names, making them easy to search for in the metric explorer.

You can also import the sample [Grafana dashboard](https://github.com/sodazone/ocelloids-services/tree/main/packages/server/guides/telemetry/grafana/xcmon_dashboard.json) that we have prepared by following the steps outlined below.

After logging in to the Grafana UI, go to 'Dashboards', expand the menu under 'New' (located in the top-right corner of the screen), and select 'Import'. Alternatively, go to [http://localhost:3001/dashboard/import](http://localhost:3001/dashboard/import) and import the JSON file provided at `packages/server/guides/telemetry/grafana/xcmon_dashboard.json`.

## Alertmanager

If you wish to receive Prometheus alerts, please configure the [alert rules](https://github.com/sodazone/ocelloids-services/tree/main/packages/server/guides/telemetry/prometheus/alert.rules) and set up receivers in the Alertmanager [configuration file](https://github.com/sodazone/ocelloids-services/tree/main/packages/server/guides/telemetry/alertmanager/config.yml). For more information on configuring alerting in Prometheus, refer to the [Prometheus Alerting Guide](https://prometheus.io/docs/alerting/latest/overview/).

## Troubleshooting

If the telemetry services are running and connected to the Ocelloids service node, you should see incoming requests from Prometheus in the logs similar to the ones shown below.

If running in docker:

```json
{"level":30,"time":1714643943130,"pid":1,"hostname":"36c1530b611c","reqId":"req-sx","req":{"method":"GET","url":"/metrics","hostname":"host.docker.internal:3000","remoteAddress":"172.17.0.1","remotePort":59504},"msg":"incoming request"}
```

If running in command line:

```shell
[14:26:13 UTC] INFO: incoming request
    reqId: "req-2"
    req: {
      "method": "GET",
      "url": "/metrics",
      "hostname": "host.docker.internal:3000",
      "remoteAddress": "172.19.0.3",
      "remotePort": 35024
    }
```

If the telemetry docker containers are running but you do not see these logs, it indicates that Prometheus is unable to connect from inside the container. In this case, map `host.docker.internal` to your IP address in the `services.prometheus.extra_hosts` configuration.

For example, if your IP address is `192.168.0.146`, the configuration should look like:

```
extra_hosts:
  - host.docker.internal:192.168.0.146
```