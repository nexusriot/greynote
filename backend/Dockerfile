FROM golang:1.22-alpine AS build

WORKDIR /app

# sqlite needs gcc/musl-dev
RUN apk add --no-cache build-base

COPY go.mod go.sum ./
RUN go mod download

COPY . .
# Stamped into the binary so a running container can say what it is.
ARG VERSION=dev

# sqlite_fts5 enables the FTS5 extension the search index needs; without it the
# server still runs but falls back to scanning.
RUN CGO_ENABLED=1 GOOS=linux go build -tags sqlite_fts5 \
    -ldflags "-s -w -X main.version=${VERSION}" -o server .

FROM alpine:3.20

WORKDIR /app
RUN apk add --no-cache ca-certificates

COPY --from=build /app/server /app/server

# data dir for sqlite volume
RUN mkdir -p /data

EXPOSE 8080
CMD ["/app/server"]
