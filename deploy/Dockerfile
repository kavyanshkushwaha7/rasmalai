FROM node:22-bookworm-slim

WORKDIR /app
COPY --chown=node:node . .
USER node

# Workspace postinstall generates Prisma from the checked-in schema. This
# does not connect to PostgreSQL.
RUN npm ci

ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_REALTIME_URL=
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_REALTIME_URL=${NEXT_PUBLIC_REALTIME_URL}
ENV NODE_ENV=production

RUN npm run build --workspace @rasmalai/web
RUN npm prune --omit=dev --ignore-scripts

ENV SPECTATOR_MODE_ENABLED=false
ENV REALTIME_HOST=0.0.0.0
ENV REALTIME_PORT=4100

EXPOSE 3000 4100
