package app

import (
	"os"
	"path/filepath"
	"strings"
)

const defaultListenAddress = "0.0.0.0:5000"

// Config contains the runtime paths and listener settings used by the server.
type Config struct {
	DataDir       string
	WebDir        string
	ListenAddress string
	BasePath      string
	SessionSecret string
}

// LoadConfig reads the service configuration from environment variables.
func LoadConfig() Config {
	webDir := strings.TrimSpace(os.Getenv("BABY_TRACKER_WEB_DIR"))
	if webDir == "" {
		webDir = "."
	}
	dataDir := strings.TrimSpace(os.Getenv("BABY_TRACKER_DATA_DIR"))
	if dataDir == "" {
		dataDir = filepath.Join(".", "data")
	}
	listenAddress := strings.TrimSpace(os.Getenv("BABY_TRACKER_LISTEN_ADDRESS"))
	if listenAddress == "" {
		if port := strings.TrimSpace(os.Getenv("PORT")); port != "" {
			listenAddress = ":" + port
		} else {
			listenAddress = defaultListenAddress
		}
	}
	basePath := normalizePath(os.Getenv("BABY_TRACKER_BASE_PATH"))
	if basePath == "/" {
		basePath = ""
	}

	return Config{
		DataDir:       dataDir,
		WebDir:        webDir,
		ListenAddress: listenAddress,
		BasePath:      strings.TrimRight(basePath, "/"),
		SessionSecret: strings.TrimSpace(os.Getenv("SECRET_KEY")),
	}
}
