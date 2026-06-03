# syntax=docker/dockerfile:1
#
# Self-built Memos image that serves under a configurable sub-path (BASE_PATH),
# so the plugin can be hosted at https://<dootask>/apps/memos/ behind the main
# DooTask nginx instead of a dedicated port. Clones the pinned upstream tag,
# applies the sub-path frontend patches, then builds the standard Memos binary
# with the patched frontend embedded.

ARG MEMOS_VERSION=v0.29.0
ARG BASE_PATH=/apps/memos/

# ---- fetch + patch source ----
FROM alpine/git AS src
ARG MEMOS_VERSION
WORKDIR /memos
RUN git clone --depth 1 --branch ${MEMOS_VERSION} https://github.com/usememos/memos.git .
COPY patch.sh /patch.sh
COPY overlay /overlay
RUN apk add --no-cache perl && sh /patch.sh /memos

# ---- build frontend (with sub-path baked in) ----
FROM --platform=$BUILDPLATFORM node:24-alpine AS frontend
ARG BASE_PATH
WORKDIR /memos
COPY --from=src /memos /memos
RUN corepack enable
WORKDIR /memos/web
RUN pnpm install --frozen-lockfile
# `release` outputs to ../server/router/frontend/dist for the Go embed.
RUN BASE_PATH=${BASE_PATH} pnpm release

# ---- build backend (embeds the frontend) ----
FROM --platform=$BUILDPLATFORM golang:1.26.2-alpine AS backend
WORKDIR /backend-build
RUN apk add --no-cache git ca-certificates
COPY --from=frontend /memos /backend-build
ARG TARGETOS TARGETARCH MEMOS_VERSION
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build \
      -trimpath \
      -ldflags="-s -w -X github.com/usememos/memos/internal/version.Version=${MEMOS_VERSION} -extldflags '-static'" \
      -tags netgo,osusergo \
      -o memos \
      ./cmd/memos

# ---- final image ----
FROM alpine:3.21 AS monolithic
RUN apk add --no-cache tzdata ca-certificates su-exec && \
    addgroup -g 10001 -S nonroot && \
    adduser -u 10001 -S -G nonroot -h /var/opt/memos nonroot && \
    mkdir -p /var/opt/memos /usr/local/memos && \
    chown -R nonroot:nonroot /var/opt/memos
COPY --from=backend /backend-build/memos /usr/local/memos/memos
COPY --from=backend --chmod=755 /backend-build/scripts/entrypoint.sh /usr/local/memos/entrypoint.sh
USER root
WORKDIR /var/opt/memos
VOLUME /var/opt/memos
ENV TZ="UTC" \
    MEMOS_PORT="5230"
EXPOSE 5230
ENTRYPOINT ["/usr/local/memos/entrypoint.sh", "/usr/local/memos/memos"]
