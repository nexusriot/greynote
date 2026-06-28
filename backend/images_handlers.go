package main

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

type ImagesHandlers struct {
	Dir string
}

func NewImagesHandlers(dir string) *ImagesHandlers {
	return &ImagesHandlers{Dir: dir}
}

// POST /api/images (authenticated) — upload an image, return its public URL
func (h *ImagesHandlers) Upload(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no file provided"})
		return
	}
	defer file.Close()

	if header.Size > 5*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file too large (max 5 MB)"})
		return
	}

	// Detect content type from actual bytes (not client-supplied header)
	buf := make([]byte, 512)
	n, _ := file.Read(buf)
	ct := http.DetectContentType(buf[:n])
	if !strings.HasPrefix(ct, "image/") || ct == "image/svg+xml" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only JPEG/PNG/GIF/WebP images are allowed"})
		return
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "seek error"})
		return
	}

	ext := mimeToExt(ct)
	name, err := randomTokenURLSafe(16)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token error"})
		return
	}
	filename := name + ext

	dst, err := os.Create(filepath.Join(h.Dir, filename))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "save error"})
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "write error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"url": "/api/images/" + filename})
}

// GET /api/images/:filename (public) — serve a stored image
func (h *ImagesHandlers) Serve(c *gin.Context) {
	// filepath.Base prevents path traversal (e.g. "../../etc/passwd")
	filename := filepath.Base(c.Param("filename"))
	c.File(filepath.Join(h.Dir, filename))
}

func mimeToExt(ct string) string {
	switch ct {
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	default:
		return ".jpg"
	}
}
