# syntax=docker/dockerfile:1.7

FROM golang:1.26.11-alpine AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal

RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /out/baby-tracker \
    ./cmd/baby-tracker

FROM alpine:3.22

RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S baby-tracker \
    && adduser -S -G baby-tracker -h /opt/baby-tracker baby-tracker \
    && mkdir -p /opt/baby-tracker /var/lib/baby-tracker \
    && chown -R baby-tracker:baby-tracker /opt/baby-tracker /var/lib/baby-tracker

WORKDIR /opt/baby-tracker

COPY --from=builder --chown=baby-tracker:baby-tracker /out/baby-tracker /opt/baby-tracker/baby-tracker
COPY --chown=baby-tracker:baby-tracker templates /opt/baby-tracker/templates
COPY --chown=baby-tracker:baby-tracker static /opt/baby-tracker/static
COPY --chown=baby-tracker:baby-tracker LICENSE THIRD_PARTY_NOTICES.md /opt/baby-tracker/

ENV BABY_TRACKER_WEB_DIR=/opt/baby-tracker \
    BABY_TRACKER_DATA_DIR=/var/lib/baby-tracker \
    BABY_TRACKER_LISTEN_ADDRESS=0.0.0.0:5000 \
    TZ=Asia/Shanghai

USER baby-tracker

EXPOSE 5000
VOLUME ["/var/lib/baby-tracker"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD wget -qO- http://127.0.0.1:5000/login >/dev/null || exit 1

ENTRYPOINT ["/opt/baby-tracker/baby-tracker"]
CMD ["serve"]
