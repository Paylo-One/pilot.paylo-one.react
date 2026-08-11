# syntax=docker/dockerfile:1

# Pilot production image.
# NEXT_PUBLIC_* values are baked into the client bundle at build time, so the
# image is built per-deployment with your own values via docker compose
# (build args below) — never commit real secrets; publishable keys are
# browser-safe by design, the secret key is runtime-only.

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time public config (safe to expose to the browser).
ARG NEXT_PUBLIC_APP_APEX
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_APP_APEX=$NEXT_PUBLIC_APP_APEX \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    DOCKER_BUILD=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S pilot && adduser -S pilot -G pilot
COPY --from=build --chown=pilot:pilot /app/.next/standalone ./
COPY --from=build --chown=pilot:pilot /app/.next/static ./.next/static
COPY --from=build --chown=pilot:pilot /app/public ./public
COPY --from=build --chown=pilot:pilot /app/messages ./messages
COPY --from=build --chown=pilot:pilot /app/i18n ./i18n

USER pilot
EXPOSE 3000
CMD ["node", "server.js"]
