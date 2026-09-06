# GreyNote backend. The sqlite_fts5 build tag enables the FTS5 search index;
# without it the server falls back to LIKE scanning.
TAGS := sqlite_fts5

.PHONY: build test vet fmt run

build:
	CGO_ENABLED=1 go build -tags $(TAGS) -o greynote .

test:
	go test -tags $(TAGS) ./...

vet:
	go vet -tags $(TAGS) ./...

fmt:
	gofmt -w .

run: build
	./greynote
