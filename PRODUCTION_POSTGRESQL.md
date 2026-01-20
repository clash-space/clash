# Production PostgreSQL Configuration Guide

## Overview

This document describes the production-grade PostgreSQL configuration implemented for the Master Clash API, specifically designed to handle SSL connection issues, transient network failures, and ensure high availability.

## Problem Solved

**Original Error:**
```
psycopg.OperationalError: consuming input failed: SSL connection has been closed unexpectedly
```

This error occurred when PostgreSQL connections were dropped due to:
- Network interruptions
- Server-side connection resets
- Idle connection timeouts
- SSL/TLS session timeouts
- Load balancer connection recycling (common with Neon, Supabase, etc.)

## Production Features Implemented

### 1. **Automatic Retry with Exponential Backoff**

Located in: `apps/api/src/master_clash/database/pg_checkpointer.py`

```python
async def retry_with_backoff(
    func,
    max_retries: int = 3,
    initial_delay: float = 1.0,
    max_delay: float = 30.0,
    backoff_factor: float = 2.0,
)
```

**Features:**
- Automatically retries failed operations up to 3 times
- Exponential backoff: 1s → 2s → 4s
- Specific handling for SSL connection errors
- Graceful failure after max retries

### 2. **SSL/TLS Configuration**

**Automatic SSL Mode:**
```python
if "sslmode" not in conninfo.lower():
    conninfo += " sslmode=require"
```

Ensures all connections use SSL/TLS encryption, required by modern PostgreSQL providers (Neon, Supabase, AWS RDS, etc.).

### 3. **Production-Grade Connection Pooling**

**Pool Configuration:**
```python
AsyncConnectionPool(
    min_size=2,              # Keep 2 warm connections
    max_size=20,             # Support up to 20 concurrent connections
    max_idle=300,            # Close idle connections after 5 minutes
    max_lifetime=1800,       # Recycle connections after 30 minutes
    num_workers=3,           # Background workers for health checks
)
```

**Why these settings:**
- `min_size=2`: Always maintain warm connections for fast response
- `max_size=20`: Handle concurrent requests without overwhelming DB
- `max_idle=300s`: Prevent stale connections while conserving resources
- `max_lifetime=1800s`: Force reconnection to avoid SSL session timeouts

### 4. **TCP Keepalive Settings**

Prevents silent connection failures:

```python
"keepalives": 1,              # Enable TCP keepalive
"keepalives_idle": 30,        # Start after 30s of idle
"keepalives_interval": 10,    # Check every 10s
"keepalives_count": 5,        # 5 failed checks = dead connection (50s total)
```

**How it works:**
- After 30s idle, PostgreSQL starts sending TCP keepalive probes
- If 5 consecutive probes fail (50s), connection is marked dead
- Pool automatically removes dead connections and creates new ones

### 5. **Connection Health Monitoring**

**Health Check Endpoint:**
```bash
curl http://localhost:8888/api/health
```

**Response:**
```json
{
  "status": "healthy",
  "database": {
    "postgres": {
      "is_healthy": true,
      "pool_size": 3,
      "pool_available": 2,
      "pool_min": 2,
      "pool_max": 20,
      "requests_waiting": 0
    }
  },
  "service": "master-clash-api"
}
```

### 6. **Graceful Error Handling**

**In Graph Initialization (main.py:221-255):**
- Catches SSL connection errors specifically
- Automatically resets connection pool on SSL errors
- Retries graph initialization up to 3 times
- Provides clear error messages for debugging

**Connection Pool Reset:**
```python
from master_clash.database.pg_checkpointer import reset_connection_pool
await reset_connection_pool()
```

### 7. **PgBouncer Compatibility**

```python
"prepare_threshold": 0,  # Disable prepared statements
```

This ensures compatibility with connection poolers like PgBouncer, which don't support prepared statements in transaction pooling mode.

## Environment Configuration

### Required Environment Variables

```bash
# PostgreSQL connection string (Neon, Supabase, etc.)
POSTGRES_CONNECTION_STRING="postgresql://user:password@host:5432/dbname"

# Optional: If SSL parameters not in connection string, they'll be added automatically
# Example with explicit SSL:
POSTGRES_CONNECTION_STRING="postgresql://user:password@host:5432/dbname?sslmode=require"
```

### SSL Modes Explained

| Mode | Description | Use Case |
|------|-------------|----------|
| `disable` | No SSL | Local development only |
| `allow` | SSL if available | Not recommended |
| `prefer` | Prefer SSL | Not recommended |
| `require` | **Require SSL** (default) | **Production** |
| `verify-ca` | Verify certificate | High security |
| `verify-full` | Verify cert + hostname | Maximum security |

**Recommendation:** Use `require` (default) or higher for production.

## Monitoring & Debugging

### 1. **Check Connection Pool Health**

```bash
curl http://localhost:8888/api/health | jq
```

### 2. **View Connection Pool Logs**

```bash
tail -f backend.log | grep "PostgreSQL connection pool"
```

**Success logs:**
```
INFO - PostgreSQL connection pool opened successfully (min=2, max=20)
INFO - PostgreSQL checkpointer schema initialized successfully
```

**Error logs:**
```
WARNING - SSL connection error on attempt 1/3: SSL connection has been closed unexpectedly
INFO - Retrying in 1.00s (attempt 1/3)
INFO - Connection pool reset. Next request will create a fresh pool.
```

### 3. **Monitor Connection Metrics**

Check these metrics for connection health:
- `pool_size`: Current connections (should be between min_size and max_size)
- `pool_available`: Available connections (should be > 0 under normal load)
- `requests_waiting`: Pending requests (should be 0 or low)

**Alerts:**
- If `pool_available = 0` → Connection pool exhausted, increase `max_size`
- If `requests_waiting > 0` → Requests waiting for connections
- If health check returns 503 → Database unreachable

### 4. **Debug SSL Connection Issues**

Enable detailed logging:
```python
import logging
logging.getLogger("master_clash.database.pg_checkpointer").setLevel(logging.DEBUG)
```

Check PostgreSQL server logs for SSL errors:
```sql
SELECT * FROM pg_stat_ssl;  -- Show SSL connection info
SELECT * FROM pg_stat_activity;  -- Show active connections
```

## Common Issues & Solutions

### Issue 1: "SSL connection has been closed unexpectedly"

**Cause:** Connection idle timeout, network interruption, or server restart

**Solution (Already Implemented):**
- Automatic retry with exponential backoff
- Connection pool reset on SSL errors
- TCP keepalive to detect dead connections

**Action:** No action needed - handled automatically

---

### Issue 2: "Connection pool exhausted"

**Symptoms:**
- Health check shows `pool_available = 0`
- Requests waiting `> 0`

**Solution:**
```python
# In pg_checkpointer.py, increase max_size
max_size=50,  # Increase from 20 to 50
```

**Check your DB connection limits:**
```sql
SHOW max_connections;  -- PostgreSQL setting
```

---

### Issue 3: "Too many connections"

**Symptoms:**
- PostgreSQL error: `FATAL: remaining connection slots are reserved`

**Solution:**
1. Reduce `max_size` in connection pool
2. Use PgBouncer for connection pooling
3. Increase PostgreSQL `max_connections`

**Example PgBouncer setup:**
```ini
[databases]
yourdb = host=postgres.example.com port=5432 dbname=yourdb

[pgbouncer]
pool_mode = transaction
max_client_conn = 100
default_pool_size = 20
```

---

### Issue 4: "Connection timeout"

**Symptoms:**
- Requests hang for 30+ seconds
- Error: `Timeout acquiring connection from pool`

**Solution:**
```python
# In pg_checkpointer.py, increase timeouts
timeout=60,  # Increase from 30 to 60
"connect_timeout": 60,  # Increase from 30 to 60
```

---

## Performance Tuning

### Connection Pool Sizing

**Rule of thumb:**
```
min_size = num_workers * 0.5
max_size = num_workers * 2.5

# For 8 Uvicorn workers:
min_size = 4
max_size = 20
```

### PostgreSQL Server Settings

**Recommended for production:**
```sql
-- Allow enough connections for your pool
ALTER SYSTEM SET max_connections = 100;

-- Connection limits per user
ALTER USER youruser CONNECTION LIMIT 50;

-- Idle connection timeout (30 minutes)
ALTER DATABASE yourdb SET idle_in_transaction_session_timeout = '30min';

-- Statement timeout (prevent runaway queries)
ALTER DATABASE yourdb SET statement_timeout = '60s';

-- Reload config
SELECT pg_reload_conf();
```

### Neon-Specific Settings

**IMPORTANT:** Neon uses PgBouncer-based connection pooling which has limitations:

❌ **NOT Supported with Neon Pooler:**
- `options` parameter (e.g., `statement_timeout`, `work_mem`)
- Prepared statements in transaction pooling mode
- Session-level settings via startup parameters

✅ **Neon Pooler Compatible Settings:**
```python
AsyncConnectionPool(
    min_size=2,                   # Keep warm connections
    max_size=20,                  # Scale with Neon
    kwargs={
        "autocommit": True,
        "prepare_threshold": 0,   # Required for PgBouncer
        "keepalives": 1,          # TCP keepalive works fine
        # NO "options" parameter!
    }
)
```

**How to Set Query Timeouts with Neon:**

1. **Option 1: Use Unpooled Connection (Recommended for background jobs)**
   ```bash
   # Replace -pooler endpoint with direct endpoint
   # From: ep-xxx-pooler.region.aws.neon.tech
   # To:   ep-xxx.region.aws.neon.tech
   POSTGRES_CONNECTION_STRING="postgresql://user:pass@ep-xxx.region.aws.neon.tech/db"
   ```
   Then you can use:
   ```python
   "options": "-c statement_timeout=60000"
   ```

2. **Option 2: Set in Neon Dashboard (Best for all connections)**
   - Go to Neon Console → Your Database → Settings
   - Set default `statement_timeout` at database level
   - Applies to all connections automatically

3. **Option 3: Set Per-Session (If needed)**
   ```python
   # After getting connection from pool
   async with pool.connection() as conn:
       await conn.execute("SET statement_timeout = '60s'")
       # Run your queries
   ```

**Neon Autoscaling Settings:**
```python
# Optimized for Neon's serverless architecture
min_size=2,              # Keep 2 warm connections
max_size=20,             # Neon auto-scales compute
max_lifetime=1800,       # 30min (Neon handles compute scaling)
max_idle=300,            # 5min idle timeout
```

## Deployment Checklist

- [ ] Set `POSTGRES_CONNECTION_STRING` in environment
- [ ] Ensure SSL mode is `require` or higher
- [ ] Configure health check monitoring (e.g., Kubernetes liveness probe)
- [ ] Set up alerts for connection pool exhaustion
- [ ] Configure log aggregation (e.g., CloudWatch, Datadog)
- [ ] Test connection recovery with intentional database restart
- [ ] Verify keepalive settings work with your network
- [ ] Document connection limits with your DB provider
- [ ] Set up database connection metrics dashboard
- [ ] Test under production load with load testing tools

## Testing Connection Resilience

### 1. **Test SSL Error Recovery**

Restart PostgreSQL server while API is running:
```bash
# PostgreSQL will close connections
sudo systemctl restart postgresql

# API should automatically recover within 1-4 seconds
curl http://localhost:8888/api/health
```

### 2. **Test Connection Pool Exhaustion**

Generate concurrent load:
```bash
# Install Apache Bench
sudo apt-get install apache2-utils

# Generate 100 concurrent requests
ab -n 1000 -c 100 http://localhost:8888/api/v1/stream/test-project?thread_id=test&user_input=hello

# Monitor health
watch -n 1 'curl -s http://localhost:8888/api/health | jq .database.postgres'
```

### 3. **Test Network Interruption**

Simulate network issues:
```bash
# Block PostgreSQL port temporarily
sudo iptables -A OUTPUT -p tcp --dport 5432 -j DROP

# Wait 60s (should trigger keepalive timeout)
sleep 60

# Restore connectivity
sudo iptables -D OUTPUT -p tcp --dport 5432 -j DROP

# API should recover automatically
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     FastAPI Application                     │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              /api/v1/stream Endpoint                   │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │  Graph Initialization (with retry)               │  │ │
│  │  │  • 3 retry attempts                               │  │ │
│  │  │  • Exponential backoff                            │  │ │
│  │  │  • Pool reset on SSL error                        │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ↓                                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │         AsyncPostgresSaver (LangGraph)                 │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ↓                                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │       AsyncConnectionPool (Production Config)          │ │
│  │  • min_size=2, max_size=20                             │ │
│  │  • TCP keepalive (30s idle, 10s interval)              │ │
│  │  • Connection recycling (30min lifetime)               │ │
│  │  • SSL: sslmode=require                                │ │
│  │  • Health monitoring                                   │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↓
        ┌───────────────────────────────────────┐
        │     PostgreSQL (Neon/Supabase)        │
        │  • SSL/TLS encrypted                  │
        │  • max_connections = 100              │
        │  • Serverless autoscaling             │
        └───────────────────────────────────────┘
```

## Best Practices

### 1. **Connection Management**
- ✅ Always use connection pooling
- ✅ Enable TCP keepalive
- ✅ Set connection lifetime limits
- ✅ Monitor pool metrics

### 2. **Error Handling**
- ✅ Implement retry logic for transient errors
- ✅ Reset pool on SSL connection errors
- ✅ Log errors with context for debugging
- ✅ Provide meaningful error messages

### 3. **Security**
- ✅ Always use SSL/TLS in production
- ✅ Use `sslmode=require` or higher
- ✅ Store connection strings in secrets manager (not in code)
- ✅ Rotate database credentials regularly

### 4. **Monitoring**
- ✅ Set up health check endpoints
- ✅ Monitor connection pool metrics
- ✅ Alert on pool exhaustion
- ✅ Track SSL error frequency

### 5. **Performance**
- ✅ Right-size connection pool for workload
- ✅ Use prepared statements (if not using PgBouncer)
- ✅ Set statement timeouts
- ✅ Monitor slow queries

## Support & Troubleshooting

### Get Help

1. **Check logs:** `tail -f backend.log | grep -i postgres`
2. **Check health:** `curl http://localhost:8888/api/health`
3. **Check pool stats:** Review `pool_size`, `pool_available` in health response
4. **Check PostgreSQL:** `SELECT * FROM pg_stat_activity;`

### Contact

- **GitHub Issues:** [Create an issue](https://github.com/your-org/clash/issues)
- **Documentation:** This file + code comments in `pg_checkpointer.py`

---

**Last Updated:** 2026-01-20
**Author:** Production Team
**Version:** 1.0
