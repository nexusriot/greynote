FROM golang:1.22-alpine AS build

WORKDIR /app

# sqlite needs gcc/musl-dev
RUN apk add --no-cache build-base

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -o server .

FROM alpine:3.20

WORKDIR /app
RUN apk add --no-cache ca-certificates

COPY --from=build /app/server /app/server

# data dir for sqlite volume
RUN mkdir -p /data

EXPOSE 8080
CMD ["/app/server"]
