## HTTP APIs

The Ocelloids Service Nodes offers convenient APIs for seamless interaction.

Explore the [Hurl requests](https://github.com/sodazone/ocelloids-services/tree/main/packages/server/guides/hurl) for comprehensive usage examples.

### Subscription API

The subscription HTTP API allows you to create and manage subscriptions to XCM interactions of your interest.

The OpenAPI documentation is published at the path [/documentation](http://localhost:3000/documentation) in your running server.

For more details, refer to [Subscription Guide](https://github.com/sodazone/ocelloids-services/blob/main/packages/server/guides/SUBSCRIPTION.md)

### Administration API

The server provides an API for administration purposes. It facilitates tasks such as reading and purging cached data, pending XCM messages and scheduled tasks. You can also consult the current chain tip of a network through this API.

For more details, refer to our [Administration Guide](https://github.com/sodazone/ocelloids-services/blob/main/packages/server/guides/ADMINISTRATION.md). 

### Healthcheck

The server exposes a healthchek endpoint at [/health](http://localhost:3000/health).