package studio

import (
	"bufio"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	webassets "github.com/AProgramerWithoutGlasses/img-gen/web"
	"github.com/go-sql-driver/mysql"
)

func env(Key, fallback string) string {
	if v := os.Getenv(Key); v != "" {
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
		Key, val, ok := strings.Cut(line, "=")
		if !ok {
			return errors.New(".env 中存在缺少等号的配置行")
		}
		Key, val = strings.TrimSpace(Key), strings.TrimSpace(val)
		if len(val) >= 2 && ((val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'')) {
			val = val[1 : len(val)-1]
		}
		if _, exists := os.LookupEnv(Key); !exists {
			if err := os.Setenv(Key, val); err != nil {
				return err
			}
		}
	}
	return s.Err()
}

// Run starts the single-instance studio from the repository working directory.
func Run() error {
	if err := loadEnv(); err != nil {
		return err
	}
	addr := env("LISTEN_ADDR", "127.0.0.1:8080")
	Base := strings.TrimRight(env("QISO_BASE_URL", "https://api.qiso.io"), "/")
	u, err := url.Parse(Base)
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
	DB, err := sql.Open("mysql", dsn.FormatDSN())
	if err != nil {
		return errors.New("MySQL 驱动初始化失败")
	}
	defer DB.Close()
	DB.SetMaxOpenConns(10)
	DB.SetMaxIdleConns(5)
	DB.SetConnMaxLifetime(3 * time.Minute)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := DB.PingContext(ctx); err != nil {
		return errors.New("MySQL 连接失败，请检查 MYSQL_DSN 和数据库权限")
	}
	// Hold a dedicated connection so only one process owns the durable queue.
	lock, err := DB.Conn(ctx)
	if err != nil {
		return err
	}
	defer lock.Close()
	var acquired int
	if err := lock.QueryRowContext(ctx, "SELECT GET_LOCK(CONCAT(DATABASE(), ':imggen-worker'), 0)").Scan(&acquired); err != nil || acquired != 1 {
		return errors.New("该数据库已有 img-gen 实例运行")
	}
	defer lock.ExecContext(context.Background(), "SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':imggen-worker'))")
	if err := Migrate(ctx, DB); err != nil {
		return fmt.Errorf("初始化数据库: %w", err)
	}
	if err := BootstrapAdmin(ctx, DB, env("ADMIN_USERNAME", "admin"), env("ADMIN_PASSWORD", os.Getenv("APP_PASSWORD"))); err != nil {
		return err
	}
	a := &App{DB: DB, Upstream: &Provider{Base: Base, Key: os.Getenv("QISO_API_KEY"), Client: &http.Client{Timeout: 5 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, SecureCookies: os.Getenv("COOKIE_SECURE") == "true"}
	if err := a.RecoverInterrupted(ctx); err != nil {
		return err
	}
	static, _ := fs.Sub(webassets.Files, ".")
	if _, err := fs.Stat(static, "studio/index.html"); err != nil {
		return errors.New("新版前端尚未构建，请先在 frontend 执行 npm ci 和 npm run build:server")
	}
	static, _ = fs.Sub(static, "studio")
	mux := a.Handler(static)
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
