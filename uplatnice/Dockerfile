# Runtime image. The app is built beforehand (npm run build); this image only copies dist/.
# Build context: repository root.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8099 \
    DB_FILE=/data/uplatnice.db

WORKDIR /app
COPY dist/server.mjs ./server.mjs
COPY dist/web ./web

ARG BUILD_VERSION=dev
ARG BUILD_ARCH=aarch64
LABEL io.hass.name="Uplatnice" \
      io.hass.type="addon" \
      io.hass.version="${BUILD_VERSION}" \
      io.hass.arch="${BUILD_ARCH}" \
      org.opencontainers.image.source="https://github.com/bubafinder/uplatnice-ha"

EXPOSE 8099
CMD ["node", "--disable-warning=ExperimentalWarning", "server.mjs"]
