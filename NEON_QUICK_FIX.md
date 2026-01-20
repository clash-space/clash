# Neon PostgreSQL Quick Fix Guide

## ✅ Problem Fixed

**Error:**
```
ERROR: unsupported startup parameter in options: statement_timeout
Please use unpooled connection or remove this parameter from the startup package
```

**Root Cause:** Neon's pooler (PgBouncer-based) doesn't support `options` parameter with startup settings.

**Solution:** Removed `statement_timeout` from connection pool configuration.

---

## 🚀 Quick Start

### 1. Verify Your Connection String

Make sure you're using the **pooled** connection string from Neon:

```bash
# ✅ CORRECT - Pooled connection (works with our fix)
POSTGRES_CONNECTION_STRING="postgresql://user:pass@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/dbname"

# ⚠️ Alternative - Unpooled (works but slower)
POSTGRES_CONNECTION_STRING="postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/dbname"
```

### 2. Start Your API

```bash
cd apps/api
source .venv/bin/activate  # or: .venv\Scripts\activate on Windows
uvicorn master_clash.api.main:app --host 0.0.0.0 --port 8888 --reload
```

### 3. Test the Connection

```bash
# Check health endpoint
curl http://localhost:8888/api/health | jq

# Expected output:
# {
#   "status": "healthy",
#   "database": {
#     "postgres": {
#       "is_healthy": true,
#       "pool_size": 2,
#       "pool_available": 2,
#       ...
#     }
#   }
# }
```

---

## 🔧 Configuration Reference

### Current Settings (Optimized for Neon)

```python
# apps/api/src/master_clash/database/pg_checkpointer.py

AsyncConnectionPool(
    min_size=2,                    # 2 warm connections always ready
    max_size=20,                   # Scale up to 20 concurrent connections

    # Connection settings
    autocommit=True,               # Required for LangGraph
    prepare_threshold=0,           # Neon pooler compatibility
    connect_timeout=30,            # 30s connection timeout

    # TCP Keepalive (detects dead connections)
    keepalives=1,                  # Enabled
    keepalives_idle=30,            # Start after 30s idle
    keepalives_interval=10,        # Check every 10s
    keepalives_count=5,            # 5 failed checks = dead (50s total)

    # Pool lifecycle
    timeout=30,                    # 30s to get connection from pool
    max_idle=300,                  # Close idle connections after 5min
    max_lifetime=1800,             # Recycle connections after 30min
)
```

### SSL Configuration (Automatic)

SSL mode is automatically added if not present:
```python
# Automatically adds sslmode=require for security
# You can override by including it in your connection string:
POSTGRES_CONNECTION_STRING="postgresql://...?sslmode=verify-full"
```

---

## 🎯 Common Issues & Solutions

### Issue 1: Connection Pool Not Initializing

**Symptoms:**
```
Connection pool not initialized
```

**Fix:**
```bash
# Check your .env file has the connection string
cat apps/api/.env | grep POSTGRES

# If missing, add it:
echo 'POSTGRES_CONNECTION_STRING="postgresql://..."' >> apps/api/.env
```

---

### Issue 2: SSL Connection Errors

**Symptoms:**
```
SSL connection has been closed unexpectedly
```

**Fix:**
✅ **Already handled automatically!**
- The system will retry 3 times with exponential backoff
- Connection pool resets automatically
- Recovery happens in 1-4 seconds

**Monitor recovery:**
```bash
# Watch the logs
tail -f backend.log | grep -i "SSL connection\|Retrying"

# Check health during recovery
watch -n 1 'curl -s http://localhost:8888/api/health | jq .database.postgres.is_healthy'
```

---

### Issue 3: Pool Exhaustion

**Symptoms:**
```json
{
  "pool_available": 0,
  "requests_waiting": 10
}
```

**Fix:**
Increase `max_size` in `pg_checkpointer.py`:
```python
max_size=50,  # Increase from 20 to 50
```

**Check Neon connection limit:**
- Free tier: 100 connections
- Pro tier: 300+ connections
- Make sure `max_size` < Neon limit

---

### Issue 4: Need Query Timeouts

**Problem:** Removed `statement_timeout`, but need to prevent long queries

**Solutions:**

**Option A: Set in Neon Dashboard (Recommended)**
1. Go to Neon Console → Database → Settings
2. Set `statement_timeout = 60s`
3. Applies to all connections automatically

**Option B: Use Unpooled Connection**
```bash
# Change from pooler to direct endpoint
# Before: ep-xxx-pooler.ap-southeast-1.aws.neon.tech
# After:  ep-xxx.ap-southeast-1.aws.neon.tech
```

Then add to code:
```python
kwargs={
    "options": "-c statement_timeout=60000",  # Now works!
}
```

**Option C: Set Per-Query** (if needed for specific queries)
```python
async with pool.connection() as conn:
    await conn.execute("SET statement_timeout = '60s'")
    result = await conn.execute("SELECT ...")
```

---

## 📊 Monitoring Commands

### Check Pool Health
```bash
curl -s http://localhost:8888/api/health | jq '.database.postgres'
```

### Watch Pool Metrics Live
```bash
watch -n 2 'curl -s http://localhost:8888/api/health | jq ".database.postgres | {healthy: .is_healthy, size: .pool_size, available: .pool_available, waiting: .requests_waiting}"'
```

### Monitor Connection Events
```bash
# Watch for connection pool events
tail -f backend.log | grep -i "PostgreSQL connection pool"

# Watch for SSL errors
tail -f backend.log | grep -i "SSL connection"

# Watch for retries
tail -f backend.log | grep -i "Retrying"
```

### Check PostgreSQL Connections from Neon
```sql
-- Connect to Neon console or using psql
SELECT count(*) as total_connections,
       state,
       application_name
FROM pg_stat_activity
WHERE datname = 'your_db_name'
GROUP BY state, application_name;
```

---

## ✅ Testing Checklist

- [ ] Connection pool opens successfully (no errors in logs)
- [ ] Health endpoint returns `"status": "healthy"`
- [ ] Pool metrics show `pool_size >= 2`
- [ ] Can make successful API requests to `/api/v1/stream`
- [ ] SSL connection errors auto-recover (if tested)
- [ ] No warnings about `statement_timeout` in logs

---

## 🆘 Still Having Issues?

### 1. Enable Debug Logging

```python
# In main.py or config
import logging
logging.getLogger("master_clash.database.pg_checkpointer").setLevel(logging.DEBUG)
logging.getLogger("psycopg.pool").setLevel(logging.DEBUG)
```

### 2. Check Neon Status

Visit: https://neon.tech/status

### 3. Verify Connection String

```bash
# Test connection directly with psql
psql "postgresql://user:pass@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/db" -c "SELECT version();"
```

### 4. Check Firewall/Network

```bash
# Test connectivity to Neon
telnet ep-xxx-pooler.ap-southeast-1.aws.neon.tech 5432

# Or with nc
nc -zv ep-xxx-pooler.ap-southeast-1.aws.neon.tech 5432
```

---

## 📝 Files Modified

1. **`apps/api/src/master_clash/database/pg_checkpointer.py`**
   - ✅ Removed `statement_timeout` from options
   - ✅ Added Neon pooler compatibility comments
   - ✅ Kept all other production features (retry, keepalive, SSL, etc.)

2. **`PRODUCTION_POSTGRESQL.md`**
   - ✅ Added Neon-specific configuration section
   - ✅ Documented pooler limitations
   - ✅ Provided alternative solutions for query timeouts

---

## 🎉 What's Fixed

✅ **No more "unsupported startup parameter" errors**
✅ **Neon pooler fully compatible**
✅ **SSL connection auto-recovery still works**
✅ **Retry logic with exponential backoff still active**
✅ **TCP keepalive for dead connection detection still enabled**
✅ **Connection pool health monitoring still available**
✅ **Production-grade reliability maintained**

---

**Ready to test!** 🚀

Start your API and the Neon pooler error should be completely resolved.
