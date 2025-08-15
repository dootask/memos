FROM golang:1.24-alpine AS backend
WORKDIR /backend-build

# Copy go mod files
COPY app/go.mod app/go.sum ./
RUN go mod download

# Copy source code
COPY app/ .

# Build backend
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -ldflags="-s -w" -o memos ./bin/memos/main.go

# Final stage
FROM alpine:latest AS runtime
WORKDIR /usr/local/memos

RUN apk add --no-cache tzdata
ENV TZ="UTC"

# Copy binary and entrypoint
COPY --from=backend /backend-build/memos /usr/local/memos/
COPY app/scripts/entrypoint.sh /usr/local/memos/

EXPOSE 5230

# Directory to store the data
RUN mkdir -p /var/opt/memos
VOLUME /var/opt/memos

ENV MEMOS_MODE="prod"
ENV MEMOS_PORT="5230"

ENTRYPOINT ["./entrypoint.sh", "./memos"]
