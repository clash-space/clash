# 🚀 Production Deployment Checklist

## ✅ Pre-Deployment Verification

### 1. Verify Code Changes
```bash
# Check syntax of modified files
python3 -m py_compile apps/api/src/master_clash/database/pg_checkpointer.py
python3 -m py_compile apps/api/src/master_clash/api/main.py

# Verify git status
git status
```

**Expected files modified:**
- ✅ `apps/api/src/master_clash/database/pg_checkpointer.py`
- ✅ `apps/api/src/master_clash/api/main.py`
- ✅ `apps/api/src/master_clash/workflow/middleware.py` (if any changes)

**New documentation files:**
- ✅ `PRODUCTION_POSTGRESQL.md`
- ✅ `NEON_QUICK_FIX.md`
- ✅ `test_connection_resilience.md`
- ✅ `DEPLOYMENT_CHECKLIST.md`

---

### 2. Environment Configuration
```bash
# Check .env file exists
ls -la apps/api/.env

# Verify required variables
grep POSTGRES_CONNECTION_STRING apps/api/.env
```

**Required environment variable:**
```bash
POSTGRES_CONNECTION_STRING="postgresql://user:password@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/dbname"
```

**Verify connection string format:**
- ✅ Should contain `-pooler` in hostname (using Neon pooler)
- ✅ Should NOT have `options` or `statement_timeout` parameters
- ✅ Can optionally have `sslmode=require` (will be added automatically if missing)

---

### 3. Dependencies Check
```bash
cd apps/api

# Verify virtual environment
source .venv/bin/activate  # or .venv\Scripts\activate on Windows

# Check required packages
pip list | grep -E "psycopg|langgraph|fastapi"
```

**Expected packages:**
- `psycopg >= 3.0`
- `psycopg-pool >= 3.0`
- `langgraph`
- `fastapi`

---

## 🧪 Local Testing

### Test 1: Startup Test
```bash
cd apps/api
source .venv/bin/activate
uvicorn master_clash.api.main:app --host 0.0.0.0 --port 8888 --reload
```

**Expected output:**
```
INFO - Added sslmode=require to connection string for production security
INFO - PostgreSQL connection pool opened successfully (min=2, max=20)
INFO - PostgreSQL checkpointer schema initialized successfully
INFO - Application startup complete.
```

**❌ Should NOT see:**
```
ERROR: unsupported startup parameter in options: statement_timeout
```

---

### Test 2: Health Check
```bash
# In a new terminal
curl http://localhost:8888/api/health | jq
```

**Expected response:**
```json
{
  "status": "healthy",
  "database": {
    "postgres": {
      "is_healthy": true,
      "pool_size": 2,
      "pool_available": 2,
      "pool_min": 2,
      "pool_max": 20,
      "requests_waiting": 0
    }
  },
  "service": "master-clash-api"
}
```

---

### Test 3: API Endpoint Test
```bash
# Test a basic workflow endpoint
curl "http://localhost:8888/api/v1/stream/test-project?thread_id=test-$(date +%s)&user_input=hello"
```

**Expected:**
- Should start streaming events
- No PostgreSQL connection errors
- Workflow should execute successfully

---

### Test 4: Connection Recovery Test
```bash
# Monitor logs in one terminal
tail -f backend.log | grep -i "postgres\|ssl\|retry"

# In another terminal, restart the test
# The connection should auto-recover if there are any transient issues
```

**Expected behavior:**
- If connection drops: Automatic retry with exponential backoff
- Recovery within 1-4 seconds
- No failed requests (retries are transparent)

---

## 📦 Commit and Deploy

### Step 1: Review Changes
```bash
# Review all changes
git diff apps/api/src/master_clash/database/pg_checkpointer.py
git diff apps/api/src/master_clash/api/main.py

# Check for any debug code or commented sections
grep -r "TODO\|FIXME\|XXX\|HACK" apps/api/src/master_clash/database/
```

---

### Step 2: Commit Changes
```bash
# Add modified files
git add apps/api/src/master_clash/database/pg_checkpointer.py
git add apps/api/src/master_clash/api/main.py
git add PRODUCTION_POSTGRESQL.md
git add NEON_QUICK_FIX.md
git add test_connection_resilience.md
git add DEPLOYMENT_CHECKLIST.md

# Create commit
git commit -m "fix: PostgreSQL connection resilience and Neon pooler compatibility

- Add production-grade connection pooling with retry logic
- Fix SSL connection errors with TCP keepalive and auto-recovery
- Remove statement_timeout to fix Neon pooler compatibility
- Add connection health monitoring endpoint (/api/health)
- Add comprehensive production documentation

Fixes:
- SSL connection unexpectedly closed errors
- Neon pooler 'unsupported startup parameter' error

Features:
- Automatic retry with exponential backoff (3 attempts)
- TCP keepalive for dead connection detection (30s idle, 10s interval)
- Connection pool auto-recovery on SSL errors
- Connection lifecycle management (30min max lifetime, 5min idle timeout)
- Health check endpoint for monitoring
- Detailed logging and error tracking

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Step 3: Push to Repository
```bash
# Push to your branch
git push origin master  # or your feature branch

# If deploying via CI/CD, wait for pipeline to complete
```

---

## 🌐 Production Deployment

### Pre-Production Checklist
- [ ] All local tests passed
- [ ] Code reviewed and committed
- [ ] Environment variables configured in production
- [ ] Neon database accessible from production environment
- [ ] SSL certificates valid (if using custom SSL)
- [ ] Monitoring and alerting configured

---

### Deployment Steps

#### Option A: Direct Deployment
```bash
# SSH to production server
ssh user@production-server

# Pull latest code
cd /path/to/clash
git pull origin master

# Install/update dependencies
cd apps/api
source .venv/bin/activate
pip install -r requirements.txt

# Restart the service
sudo systemctl restart master-clash-api
# or
pm2 restart master-clash-api
# or
supervisorctl restart master-clash-api
```

---

#### Option B: Docker Deployment
```bash
# Build new image
docker build -t master-clash-api:latest -f apps/api/Dockerfile .

# Stop old container
docker stop master-clash-api

# Start new container
docker run -d \
  --name master-clash-api \
  -p 8888:8888 \
  -e POSTGRES_CONNECTION_STRING="$POSTGRES_CONNECTION_STRING" \
  --restart unless-stopped \
  master-clash-api:latest
```

---

#### Option C: Kubernetes Deployment
```bash
# Update ConfigMap with new connection string (if needed)
kubectl create configmap api-config \
  --from-literal=POSTGRES_CONNECTION_STRING="$POSTGRES_CONNECTION_STRING" \
  --dry-run=client -o yaml | kubectl apply -f -

# Deploy new version
kubectl apply -f k8s/api-deployment.yaml

# Watch rollout
kubectl rollout status deployment/master-clash-api

# Verify pods are healthy
kubectl get pods -l app=master-clash-api
```

---

## ✅ Post-Deployment Verification

### 1. Health Check
```bash
# Replace with your production URL
curl https://your-production-url.com/api/health | jq

# Or use health check monitoring
curl -f https://your-production-url.com/api/health || echo "HEALTH CHECK FAILED"
```

**Expected:**
- HTTP 200 status
- `"status": "healthy"`
- `"is_healthy": true`

---

### 2. Monitor Logs
```bash
# Check application logs for any errors
# Docker:
docker logs -f master-clash-api --tail 100

# Kubernetes:
kubectl logs -f deployment/master-clash-api --tail 100

# Systemd:
journalctl -u master-clash-api -f --lines 100

# PM2:
pm2 logs master-clash-api --lines 100
```

**Watch for:**
- ✅ "PostgreSQL connection pool opened successfully"
- ✅ "PostgreSQL checkpointer schema initialized successfully"
- ❌ NO "unsupported startup parameter" errors
- ❌ NO "SSL connection has been closed" errors (or they should auto-recover)

---

### 3. Connection Pool Metrics
```bash
# Monitor connection pool health over time
watch -n 5 'curl -s https://your-production-url.com/api/health | jq .database.postgres'
```

**Monitor for:**
- `pool_size`: Should stay between 2-20
- `pool_available`: Should be > 0
- `requests_waiting`: Should be 0 or low
- `is_healthy`: Should always be `true`

---

### 4. End-to-End Test
```bash
# Test actual workflow execution
curl -X POST "https://your-production-url.com/api/v1/stream/test-project?thread_id=prod-test-$(date +%s)&user_input=test" \
  --no-buffer
```

**Expected:**
- Streaming events received
- No connection errors
- Workflow completes successfully

---

### 5. Load Test (Optional but Recommended)
```bash
# Run load test to verify connection pool handles concurrent requests
ab -n 1000 -c 50 https://your-production-url.com/api/health

# Monitor connection pool during load test
watch -n 1 'curl -s https://your-production-url.com/api/health | jq .database.postgres'
```

**Expected:**
- All requests succeed (no 500 errors)
- `pool_size` scales up (max 20)
- `pool_available` > 0
- `requests_waiting` stays low

---

## 🔍 Monitoring Setup

### Set Up Health Check Alerts

#### Kubernetes Liveness Probe
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: master-clash-api
spec:
  containers:
  - name: api
    image: master-clash-api:latest
    livenessProbe:
      httpGet:
        path: /api/health
        port: 8888
      initialDelaySeconds: 30
      periodSeconds: 10
      timeoutSeconds: 5
      failureThreshold: 3
    readinessProbe:
      httpGet:
        path: /api/health
        port: 8888
      initialDelaySeconds: 10
      periodSeconds: 5
      timeoutSeconds: 3
      failureThreshold: 2
```

---

#### Uptime Monitoring (UptimeRobot, Pingdom, etc.)
- URL: `https://your-production-url.com/api/health`
- Interval: 1-5 minutes
- Expected: HTTP 200
- Alert on: HTTP 503 or timeout

---

#### Prometheus Metrics (Advanced)
```python
# Add to main.py for Prometheus metrics
from prometheus_client import make_asgi_app, Gauge

# Create metrics
db_pool_size = Gauge('db_pool_size', 'Database connection pool size')
db_pool_available = Gauge('db_pool_available', 'Available database connections')

# Update in health endpoint
@app.get("/api/health")
async def health_check():
    pool_health = await get_pool_health()
    db_pool_size.set(pool_health.get('pool_size', 0))
    db_pool_available.set(pool_health.get('pool_available', 0))
    # ... rest of health check

# Mount Prometheus metrics endpoint
metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)
```

---

## 🐛 Troubleshooting

### Issue: Connection Pool Not Initializing

**Symptoms:**
```json
{
  "is_healthy": false,
  "error": "Connection pool not initialized"
}
```

**Solutions:**
1. Check environment variable is set:
   ```bash
   echo $POSTGRES_CONNECTION_STRING
   ```
2. Verify Neon database is accessible:
   ```bash
   psql "$POSTGRES_CONNECTION_STRING" -c "SELECT 1"
   ```
3. Check firewall/network rules
4. Restart the application

---

### Issue: SSL Connection Errors Still Occurring

**Symptoms:**
```
SSL connection has been closed unexpectedly
```

**Solutions:**
1. Verify TCP keepalive settings are in place:
   ```bash
   grep -A 5 "keepalives" apps/api/src/master_clash/database/pg_checkpointer.py
   ```
2. Check if errors are transient (should auto-recover in 1-4s)
3. Increase `max_lifetime` if connections expire too quickly
4. Check Neon status: https://neon.tech/status

---

### Issue: Neon Pooler Parameter Error

**Symptoms:**
```
ERROR: unsupported startup parameter in options: statement_timeout
```

**Solutions:**
1. Verify `statement_timeout` was removed:
   ```bash
   grep "statement_timeout" apps/api/src/master_clash/database/pg_checkpointer.py
   # Should only appear in comments
   ```
2. Check you're using the latest code:
   ```bash
   git log --oneline -1
   ```
3. Restart application to load new code

---

### Issue: Pool Exhaustion

**Symptoms:**
```json
{
  "pool_available": 0,
  "requests_waiting": 25
}
```

**Solutions:**
1. Increase `max_size` in `pg_checkpointer.py`:
   ```python
   max_size=50,  # Increase from 20
   ```
2. Check Neon connection limit (Free: 100, Pro: 300+)
3. Optimize slow queries to release connections faster
4. Consider using PgBouncer externally

---

## 📊 Success Metrics

Your deployment is successful if:

- ✅ Health endpoint returns 200 and `"healthy"`
- ✅ No "unsupported startup parameter" errors in logs
- ✅ SSL connection errors (if any) auto-recover within 4 seconds
- ✅ Connection pool maintains 2-20 connections
- ✅ No requests fail due to connection issues
- ✅ Application runs for 24+ hours without database errors
- ✅ Load tests show consistent performance

---

## 📞 Support

If you encounter issues:

1. **Check logs first:**
   ```bash
   tail -f backend.log | grep -i "error\|warning"
   ```

2. **Verify health endpoint:**
   ```bash
   curl http://localhost:8888/api/health | jq
   ```

3. **Review documentation:**
   - `PRODUCTION_POSTGRESQL.md` - Detailed production guide
   - `NEON_QUICK_FIX.md` - Quick troubleshooting
   - `test_connection_resilience.md` - Testing procedures

4. **Check Neon status:**
   - https://neon.tech/status
   - https://neon.tech/docs/connect/connection-errors

---

## 🎉 Deployment Complete!

Once all checks pass, your production deployment is complete.

The system now has:
- ✅ Production-grade PostgreSQL connection pooling
- ✅ Automatic SSL connection recovery
- ✅ Neon pooler compatibility
- ✅ Health monitoring endpoint
- ✅ Comprehensive error handling and retry logic

**Last Updated:** 2026-01-20
**Version:** 1.0.0
