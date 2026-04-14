#!/usr/bin/env python3
"""P1优化：为操作步骤类QA补充注意事项"""
import sqlite3, json, time, sys, os
import urllib.request

DB_PATH = '/root/lexiang/lexiang.db'
API_KEY = 'sk-3f53104ba295403890bab6b9fee8e773'
API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
MODEL = 'qwen3.5-plus'

SYSTEM_PROMPT = """你是联想技术支持知识库编辑。用户给你一组QA对，每条的answer包含操作步骤但缺少注意事项。

你的任务：为每条answer的末尾追加一段"⚠️ 注意事项"，包含：
1. 前提条件（如需插电、需管理员权限等）
2. 数据安全提醒（如建议先备份）
3. 操作风险（如可能丢失数据、需要重装驱动等）
4. 常见误区提醒

规则：
- 注意事项要简洁实用，2-4条即可，不要凑数
- 语气专业友好，不要用"亲"等客服口语
- 只输出JSON数组，每个元素是 {"id": 数字, "warning": "补充的注意事项文本"}
- warning 文本以 "\\n\\n⚠️ 注意事项：\\n" 开头
- 如果某条answer不需要补充（已经足够完整），warning设为空字符串""
- 不要修改原有answer内容，只输出需要追加的部分"""

def call_api(messages, retries=3):
    """调用DashScope API"""
    body = json.dumps({
        "model": MODEL,
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": 4000,
    }).encode()

    for attempt in range(retries):
        try:
            req = urllib.request.Request(API_URL, data=body, headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {API_KEY}',
            })
            with urllib.request.urlopen(req, timeout=120) as resp:
                result = json.loads(resp.read())
                content = result['choices'][0]['message']['content']
                # 去掉可能的markdown代码块标记
                content = content.strip()
                if content.startswith('```'):
                    content = content.split('\n', 1)[1] if '\n' in content else content[3:]
                if content.endswith('```'):
                    content = content[:-3]
                content = content.strip()
                return json.loads(content)
        except Exception as e:
            print(f"  API调用失败(尝试{attempt+1}): {e}")
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
    return None

def get_p1_records(db):
    """获取需要补充注意事项的QA"""
    cursor = db.execute("""
        SELECT id, question, answer FROM knowledge_qa
        WHERE (answer LIKE '%步骤%' OR answer LIKE '%第一步%' OR answer LIKE '%第二步%'
           OR answer LIKE '%操作方法%' OR answer LIKE '%进入BIOS%' OR answer LIKE '%重启%'
           OR answer LIKE '%重装%' OR answer LIKE '%格式化%' OR answer LIKE '%恢复出厂%'
           OR answer LIKE '%强制关机%' OR answer LIKE '%长按电源%')
        AND answer NOT LIKE '%注意%' AND answer NOT LIKE '%警告%' AND answer NOT LIKE '%风险%'
        AND answer NOT LIKE '%建议%' AND answer NOT LIKE '%提示%' AND answer NOT LIKE '%请确保%'
        AND answer NOT LIKE '%备份%'
        ORDER BY id
    """)
    return cursor.fetchall()

def process_batch(db, batch):
    """处理一批QA"""
    # 构建prompt
    qa_list = []
    for row in batch:
        qa_list.append({
            "id": row[0],
            "question": row[1][:200],  # 截断过长的
            "answer": row[2][:400],
        })

    user_msg = f"请为以下{len(qa_list)}条QA补充注意事项：\n\n{json.dumps(qa_list, ensure_ascii=False)}"

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    results = call_api(messages)
    if not results:
        print(f"  [WARN] API返回空，跳过此批")
        return 0

    updated = 0
    for item in results:
        rid = item.get('id')
        warning = item.get('warning', '')
        if not warning or not rid:
            continue

        # 追加注意事项到answer末尾
        db.execute(
            "UPDATE knowledge_qa SET answer = answer || ? WHERE id = ?",
            (warning, rid)
        )
        updated += 1

    db.commit()
    return updated

def main():
    db = sqlite3.connect(DB_PATH)
    records = get_p1_records(db)
    total = len(records)
    print(f"共 {total} 条需要补充注意事项")

    batch_size = 5
    updated_total = 0

    for i in range(0, total, batch_size):
        batch = records[i:i+batch_size]
        batch_num = i // batch_size + 1
        total_batches = (total + batch_size - 1) // batch_size

        print(f"[{batch_num}/{total_batches}] 处理 id {batch[0][0]}~{batch[-1][0]} ...", end=' ', flush=True)

        updated = process_batch(db, batch)
        updated_total += updated
        print(f"更新 {updated} 条 (累计 {updated_total}/{total})")

        # 限流：每秒最多2次请求
        time.sleep(0.5)

    db.close()
    print(f"\n完成！共更新 {updated_total}/{total} 条")

if __name__ == '__main__':
    main()
