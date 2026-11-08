FROM node:22-alpine AS frontend
WORKDIR /ui
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.25-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
COPY internal ./internal
COPY web ./web
COPY --from=frontend /ui/dist ./web/studio
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /img-gen .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata && addgroup -S app && adduser -S -G app app
WORKDIR /app
COPY --from=builder /img-gen /app/img-gen
USER app
EXPOSE 8080
ENTRYPOINT ["/app/img-gen"]
