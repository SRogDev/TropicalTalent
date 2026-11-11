"""Gunicorn configuration for production deployment."""

import multiprocessing
import os

# Server socket
bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"
backlog = 2048

# Worker processes
workers = int(os.getenv("GUNICORN_WORKERS", multiprocessing.cpu_count() * 2 + 1))
worker_class = "uvicorn.workers.UvicornWorker"
worker_connections = 1000
max_requests = 1000  # Restart workers after this many requests (prevents memory leaks)
max_requests_jitter = 50  # Add randomness to prevent all workers restarting at once
timeout = 120  # Workers silent for more than this are killed and restarted
graceful_timeout = 30  # Workers get this long to finish current requests on shutdown
keepalive = 5

# Logging
accesslog = "-"  # Log to stdout
errorlog = "-"  # Log to stderr
loglevel = os.getenv("LOG_LEVEL", "info").lower()
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s'

# Process naming
proc_name = "tropical-talent-ai"

# Server mechanics
daemon = False
pidfile = None
umask = 0
user = None
group = None
tmp_upload_dir = None

# SSL (if needed)
# keyfile = None
# certfile = None

# Preload app for better performance (shares code across workers)
preload_app = True

# Lifecycle hooks
def on_starting(server):
    """Called just before the master process is initialized."""
    server.log.info("🚀 Starting TropicalTalent AI Backend with Gunicorn")


def on_reload(server):
    """Called to recycle workers during a reload via SIGHUP."""
    server.log.info("♻️ Reloading workers")


def when_ready(server):
    """Called just after the server is started."""
    server.log.info(f"✅ Server ready. Listening on {bind}")
    server.log.info(f"👷 Workers: {workers}")
    server.log.info(f"⚙️ Worker class: {worker_class}")


def worker_int(worker):
    """Called when a worker receives the SIGINT or SIGQUIT signal."""
    worker.log.info(f"⚠️ Worker {worker.pid} interrupted")


def worker_abort(worker):
    """Called when a worker receives the SIGABRT signal."""
    worker.log.error(f"❌ Worker {worker.pid} aborted")


def pre_fork(server, worker):
    """Called just before a worker is forked."""
    pass


def post_fork(server, worker):
    """Called just after a worker has been forked."""
    server.log.info(f"👶 Worker spawned (pid: {worker.pid})")


def worker_exit(server, worker):
    """Called just after a worker has been exited."""
    server.log.info(f"👋 Worker {worker.pid} exited")
