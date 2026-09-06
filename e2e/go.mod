// The e2e suite has no dependencies beyond the standard library: it talks to the
// server the same way any HTTP client would, so it can run in a bare golang
// image with no module downloads.
module greynote/e2e

go 1.22
