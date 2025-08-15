package frontend

import (
	"context"
	"embed"
	"io/fs"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"

	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/internal/util"
	"github.com/usememos/memos/store"
)

//go:embed dist/*
var embeddedFiles embed.FS

type FrontendService struct {
	Profile *profile.Profile
	Store   *store.Store
}

func NewFrontendService(profile *profile.Profile, store *store.Store) *FrontendService {
	return &FrontendService{
		Profile: profile,
		Store:   store,
	}
}

func (*FrontendService) Serve(_ context.Context, e *echo.Echo) {
	// Create a route group for the frontend app under /apps/memos
	appGroup := e.Group("/apps/memos")

	skipper := func(c echo.Context) bool {
		// Skip API routes.
		if util.HasPrefixes(c.Path(), "/api", "/memos.api.v1") {
			return true
		}
		// Skip setting cache headers for index.html
		if c.Path() == "/apps/memos" || c.Path() == "/apps/memos/" || c.Path() == "/apps/memos/index.html" {
			return false
		}
		// Set Cache-Control header to allow public caching with a max-age of 7 days.
		c.Response().Header().Set(echo.HeaderCacheControl, "public, max-age=604800") // 7 days
		return false
	}

	// Route to serve the main app with HTML5 fallback for SPA behavior under /apps/memos
	appGroup.Use(middleware.StaticWithConfig(middleware.StaticConfig{
		Filesystem: getFileSystem("dist"),
		HTML5:      true, // Enable fallback to index.html
		Skipper:    skipper,
	}))

	// Also handle root path redirect to /apps/memos for convenience
	e.GET("/", func(c echo.Context) error {
		return c.Redirect(http.StatusMovedPermanently, "/apps/memos/")
	})
}

func getFileSystem(path string) http.FileSystem {
	fs, err := fs.Sub(embeddedFiles, path)
	if err != nil {
		panic(err)
	}
	return http.FS(fs)
}
