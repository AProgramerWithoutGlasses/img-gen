package main

import (
	"bufio"
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-sql-driver/mysql"
)

//go:embed web/*
var webFiles embed.FS

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func loadEnv() error {
	f, err := os.Open(".env")
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			return errors.New(".env 中存在缺少等号的配置行")
		}
		key, val = strings.TrimSpace(key), strings.TrimSpace(val)
		if len(val) >= 2 && ((val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'')) {
			val = val[1 : len(val)-1]
		}
		if _, exists := os.LookupEnv(key); !exists {
			if err := os.Setenv(key, val); err != nil {
				return err
			}
		}
	}
	return s.Err()
}

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	if err := loadEnv(); err != nil {
		return err
	}
	addr := env("LISTEN_ADDR", "127.0.0.1:8080")
	password := os.Getenv("APP_PASSWORD")
	if password == "" {
		host, _, err := net.SplitHostPort(addr)
		ip := net.ParseIP(host)
		if os.Getenv("APP_DEV_MODE") != "true" || err != nil || ip == nil || !ip.IsLoopback() {
			return errors.New("请设置 APP_PASSWORD；无密码开发模式仅允许绑定回环 IP")
		}
	}
	base := strings.TrimRight(env("QISO_BASE_URL", "https://api.qiso.io"), "/")
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("QISO_BASE_URL 必须是有效的 HTTP(S) 基础地址")
	}
	dsn, err := mysql.ParseDSN(os.Getenv("MYSQL_DSN"))
	if err != nil || dsn.DBName == "" {
		return errors.New("请设置有效的 MYSQL_DSN（包含数据库名称）")
	}
	dsn.ParseTime = true
	dsn.Loc = time.UTC
	if dsn.Params == nil {
		dsn.Params = map[string]string{}
	}
	dsn.Params["time_zone"] = "'+00:00'"
	dsn.Timeout = 5 * time.Second
	dsn.ReadTimeout = 30 * time.Second
	dsn.WriteTimeout = 30 * time.Second
	db, err := sql.Open("mysql", dsn.FormatDSN())
	if err != nil {
		return errors.New("MySQL 驱动初始化失败")
	}
	defer db.Close()
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(3 * time.Minute)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := db.PingContext(ctx); err != nil {
		return errors.New("MySQL 连接失败，请检查 MYSQL_DSN 和数据库权限")
	}
	if err := migrate(ctx, db); err != nil {
		return fmt.Errorf("初始化数据库: %w", err)
	}
	// Hold a dedicated connection so only one process owns the durable queue.
	lock, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer lock.Close()
	var acquired int
	if err := lock.QueryRowContext(ctx, "SELECT GET_LOCK(CONCAT(DATABASE(), ':imggen-worker'), 0)").Scan(&acquired); err != nil || acquired != 1 {
		return errors.New("该数据库已有 img-gen 实例运行")
	}
	defer lock.ExecContext(context.Background(), "SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':imggen-worker'))")
	if _, err := db.ExecContext(ctx, "UPDATE jobs SET status='failed', error='服务重启中断了任务；请手动重试以避免重复计费', finished_at=UTC_TIMESTAMP(3) WHERE status='running'"); err != nil {
		return err
	}
	a := &app{db: db, upstream: &provider{base: base, key: os.Getenv("QISO_API_KEY"), client: &http.Client{Timeout: 5 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, password: password}
	static, _ := fs.Sub(webFiles, "web")
	mux := a.routes(static)
	server := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 45 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 16 << 10}
	workerCtx, cancelWorkers := context.WithCancel(context.Background())
	defer cancelWorkers()
	for i := 0; i < 2; i++ {
		a.workers.Add(1)
		go a.worker(workerCtx)
	}
	// Losing the advisory-lock connection must stop the process, not create two queue owners.
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := lock.PingContext(ctx); err != nil {
					log.Print("队列锁连接中断，停止服务")
					stop()
					return
				}
			}
		}
	}()
	errCh := make(chan error, 1)
	go func() { log.Printf("Qiso Studio 已启动: http://%s", addr); errCh <- server.ListenAndServe() }()
	select {
	case <-ctx.Done():
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			cancelWorkers()
			a.workers.Wait()
			return err
		}
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdown)
	cancelWorkers()
	a.workers.Wait()
	return nil
}
