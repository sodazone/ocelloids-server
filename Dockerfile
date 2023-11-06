FROM node:20-alpine

WORKDIR /opt/xcmon

COPY package*.json tsconfig*.json ./
COPY patches/ ./patches
RUN npm install -g typescript patch-package && \
npm ci --omit=dev

COPY src/ ./src
RUN mkdir -p /etc/xcmon/chain-specs /etc/xcmon/config && \
npm run build

ENV NODE_ENV=production
ENV XCMON_HOST=0.0.0.0
EXPOSE 3000

CMD node dist/main.js
