#!/bin/bash
# 修复验证脚本
# 用于测试重试和数据覆盖问题的修复

set -e

echo "==================================="
echo "修复验证脚本"
echo "==================================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查 1: processingNodes 引用已全部移除
echo "✓ 检查 1: 验证 NodeProcessor.ts 中的 processingNodes 引用已移除"
if grep -n "processingNodes\." apps/loro-sync-server/src/processors/NodeProcessor.ts > /dev/null 2>&1; then
    echo -e "${RED}❌ 失败: 仍然存在 processingNodes 引用${NC}"
    grep -n "processingNodes\." apps/loro-sync-server/src/processors/NodeProcessor.ts
    exit 1
else
    echo -e "${GREEN}✅ 通过: 所有 processingNodes 引用已移除${NC}"
fi
echo ""

# 检查 2: callback_to_loro 使用 /nodes endpoint
echo "✓ 检查 2: 验证 callback_to_loro 使用正确的 /nodes endpoint"
if grep -n "callback_url}/node/{node_id}" apps/api/src/master_clash/api/tasks_router.py > /dev/null 2>&1; then
    echo -e "${RED}❌ 失败: 仍在使用错误的 /node/ 路径${NC}"
    exit 1
elif grep -n "nodes_url = " apps/api/src/master_clash/api/tasks_router.py > /dev/null 2>&1; then
    echo -e "${GREEN}✅ 通过: 正在使用 /nodes endpoint${NC}"
else
    echo -e "${YELLOW}⚠️  警告: 无法确认endpoint修改${NC}"
fi
echo ""

# 检查 3: 状态机保护存在
echo "✓ 检查 3: 验证状态机保护代码存在"
if grep -n "STATE MACHINE PROTECTION" apps/api/src/master_clash/api/tasks_router.py > /dev/null 2>&1; then
    echo -e "${GREEN}✅ 通过: 状态机保护代码已添加${NC}"
else
    echo -e "${RED}❌ 失败: 缺少状态机保护代码${NC}"
    exit 1
fi
echo ""

# 检查 4: 指数退避重试
echo "✓ 检查 4: 验证指数退避重试逻辑"
if grep -n "2 \*\* attempt" apps/api/src/master_clash/api/tasks_router.py > /dev/null 2>&1; then
    echo -e "${GREEN}✅ 通过: 指数退避代码已实现${NC}"
else
    echo -e "${RED}❌ 失败: 缺少指数退避代码${NC}"
    exit 1
fi
echo ""

echo "==================================="
echo -e "${GREEN}所有静态检查通过！${NC}"
echo "==================================="
echo ""

echo "📋 后续手动测试建议:"
echo ""
echo "1️⃣  测试防止重复提交:"
echo "   - 创建一个节点，设置 status='generating'"
echo "   - 快速发送多个 WebSocket 更新"
echo "   - 检查日志: 只应提交 1 个任务"
echo "   - 命令: grep 'Submitting.*_gen' backend.log | grep 'node-xxx'"
echo ""

echo "2️⃣  测试状态机保护:"
echo "   - 完成一个图片生成任务 (status='completed')"
echo "   - 手动触发失败 callback"
echo "   - 验证节点仍为 'completed' 状态"
echo "   - 命令: curl http://localhost:8787/sync/{projectId}/nodes | jq"
echo ""

echo "3️⃣  测试指数退避:"
echo "   - 停止 loro-sync-server"
echo "   - 触发任务完成"
echo "   - 观察日志: 应看到 1s, 2s, 4s 重试间隔"
echo "   - 命令: tail -f backend.log | grep 'Retrying in'"
echo ""

echo "4️⃣  测试 callback URL 修复:"
echo "   - 触发任意生成任务"
echo "   - 检查日志不应出现: 'Expecting value: line 1 column 1'"
echo "   - 应该看到: '✅ Node xxx updated'"
echo ""

echo "==================================="
