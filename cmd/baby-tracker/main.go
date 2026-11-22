package main

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"baby-tracker/internal/app"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: baby-tracker <serve|bootstrap|reset-password>")
		os.Exit(2)
	}
	cfg := app.LoadConfig()
	switch os.Args[1] {
	case "serve":
		if err := serve(cfg); err != nil {
			slog.Error("server stopped", "error", err)
			os.Exit(1)
		}
	case "bootstrap":
		if err := bootstrap(cfg); err != nil {
			slog.Error("bootstrap failed", "error", err)
			os.Exit(1)
		}
	case "reset-password":
		if err := resetPassword(cfg); err != nil {
			slog.Error("reset password failed", "error", err)
			os.Exit(1)
		}
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", os.Args[1])
		os.Exit(2)
	}
}

func bootstrap(cfg app.Config) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	application, err := app.New(ctx, cfg)
	if err != nil {
		return err
	}
	return application.Close()
}

func resetPassword(cfg app.Config) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	application, err := app.New(ctx, cfg)
	if err != nil {
		return err
	}
	defer application.Close()
	username, password, err := application.ResetAdminPassword(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("管理员 [%s] 密码已重置\n", username)
	fmt.Printf("新密码: %s\n", password)
	return nil
}

func serve(cfg app.Config) error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	application, err := app.New(ctx, cfg)
	if err != nil {
		return err
	}
	defer application.Close()

	server := &http.Server{
		Handler:           application.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       90 * time.Second,
	}
	listener, err := net.Listen("tcp", cfg.ListenAddress)
	if err != nil {
		return fmt.Errorf("listen on %s: %w", cfg.ListenAddress, err)
	}

	slog.Info("listening", "address", listener.Addr().String())
	errorsChannel := make(chan error, 1)
	go func() {
		if err := server.Serve(listener); err != nil {
			errorsChannel <- err
		}
	}()

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(signals)
	select {
	case sig := <-signals:
		slog.Info("shutdown requested", "signal", sig.String())
	case err := <-errorsChannel:
		cancel()
		_ = server.Close()
		return err
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()
	err = server.Shutdown(shutdownCtx)
	return err
}
