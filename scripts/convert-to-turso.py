#!/usr/bin/env python3
"""
将 server/api/ 下所有 API 路由从 sql.js 同步 API 转为 Turso 异步 API。

转换规则：
  1. db.run(sql, params)           → await runQuery(sql, params)
  2. prepare/bind/while/step 循环   → await queryAll(sql, params)
  3. prepare/bind/if/step 单条查询  → await queryOne(sql, params)
  4. import 中追加 queryAll/queryOne/runQuery
"""

import os, re, sys

API_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server', 'api')
DRY_RUN = '--dry-run' in sys.argv

changed_files = []

def process_file(filepath: str) -> bool:
    with open(filepath, 'r', encoding='utf-8') as f:
        original = f.read()

    content = original

    # ── Step 0: 跳过不需要处理的文件 ──
    if "from '" not in content or 'utils/db' not in content:
        return False

    # ── Step 1: 更新 import — 追加 queryAll, queryOne, runQuery ──
    def update_import(m):
        imports = m.group(1)
        if 'queryAll' not in imports:
            # 在 getDb 后面加
            if 'getDb' in imports:
                imports = imports.replace('getDb', 'getDb, queryAll, queryOne, runQuery')
            if 'saveDb' in imports and 'runQuery' not in imports:
                if 'queryAll' not in imports:
                    imports = imports.replace('saveDb', 'saveDb, queryAll, queryOne, runQuery')
            if 'queryAll' in imports and 'getDb' not in imports:
                # 已有 queryAll 但没 getDb，加 getDb
                pass
        return f"import {{ {imports} }} from "

    content = re.sub(
        r"import\s*\{([^}]+)\}\s*from\s*['\"].*utils/db['\"]",
        update_import,
        content
    )

    # ── Step 2: db.run(sql, params) → await runQuery(sql, params) ──
    # 匹配 db.run( ... )  包括多行
    def replace_run(m):
        sql = m.group(1)
        rest = m.group(2) or ''
        if rest.strip():
            return f'await runQuery({sql}, {rest})'
        return f'await runQuery({sql})'

    content = re.sub(
        r'db\.run\((\s*(?:`[^`]*`|"[^"]*"|\'[^\']*\'))\s*,\s*(\[[^\]]*\](?:\s*\n\s*)?)\s*\)',
        replace_run,
        content,
        flags=re.DOTALL
    )
    # 单参数 db.run(sql) — no params
    content = re.sub(
        r'db\.run\((\s*(?:`[^`]*`|"[^"]*"|\'[^\']*\'))\s*\)',
        lambda m: f'await runQuery({m.group(1)})',
        content
    )

    # ── Step 3: 处理 prepare/bind/while 循环 → queryAll ──
    # 这是最复杂的部分，用多行正则
    # 模式: const VAR = db.prepare(SQL); ... VAR.bind(...); while (VAR.step()) { ... VAR.getAsObject() ... } VAR.free();
    #
    # 简化策略：找到所有 db.prepare(...) 并在上下文中转换

    content = convert_prepare_patterns(content)

    # ── Step 4: 清理可能的残留 free() 调用 ──
    # 如果 free() 所在行独立且前面已被转换，删除它
    content = re.sub(r'^\s*\w+\.free\(\);\s*$', '', content, flags=re.MULTILINE)

    if content != original:
        changed_files.append(filepath)
        if not DRY_RUN:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
        return True
    return False


def convert_prepare_patterns(content: str) -> str:
    """
    处理 db.prepare() 相关的模式。
    策略：逐行扫描，识别 prepare → bind → while(step)/if(step) → free 模式。
    """
    lines = content.split('\n')
    result = []
    i = 0

    while i < len(lines):
        line = lines[i]

        # 检测 db.prepare( 行
        prep_match = re.search(r"(\w+)\s*=\s*db\.prepare\((.+)\)", line)
        if not prep_match:
            result.append(line)
            i += 1
            continue

        stmt_var = prep_match.group(1)
        sql_expr = prep_match.group(2)  # the SQL string

        # 向前看接下来的行，收集完整的 prepare/bind/while/free 块
        j = i + 1
        bind_params = None
        loop_lines = []
        free_found = False
        step_pattern = None  # 'while' or 'if'
        row_var = None
        loop_body = []

        while j < len(lines) and j < i + 80:  # 最多往前看 80 行
            next_line = lines[j]

            # bind
            bind_m = re.search(rf'{stmt_var}\.bind\((.+)\)', next_line)
            if bind_m:
                bind_params = bind_m.group(1)
                j += 1
                continue

            # while (VAR.step())
            while_m = re.search(rf'while\s*\(\s*{stmt_var}\.step\(\)\s*\)', next_line)
            if while_m:
                step_pattern = 'while'
                # 进入循环体 — 收集直到匹配的 }
                j += 1
                depth = 0
                started = False
                while j < len(lines):
                    body_line = lines[j]
                    # 检测 row var from getAsObject
                    ga_m = re.search(rf'(\w+)\s*=\s*{stmt_var}\.getAsObject\(\)', body_line)
                    if ga_m:
                        row_var = ga_m.group(1)
                    # count braces
                    for ch in body_line:
                        if ch == '{': depth += 1; started = True
                        elif ch == '}': depth -= 1
                    loop_body.append(body_line)
                    j += 1
                    if started and depth == 0:
                        break
                continue

            # if (VAR.step())
            if_m = re.search(rf'if\s*\(\s*{stmt_var}\.step\(\)\s*\)', next_line)
            if if_m:
                step_pattern = 'if'
                # 进入 if 块
                j += 1
                depth = 0
                started = False
                while j < len(lines):
                    body_line = lines[j]
                    ga_m = re.search(rf'(\w+)\s*=\s*{stmt_var}\.getAsObject\(\)', body_line)
                    if ga_m:
                        row_var = ga_m.group(1)
                    for ch in body_line:
                        if ch == '{': depth += 1; started = True
                        elif ch == '}': depth -= 1
                    loop_body.append(body_line)
                    j += 1
                    if started and depth == 0:
                        # 检查后面是否有 else
                        if j < len(lines) and re.match(r'\s*else', lines[j]):
                            # 有 else 分支，一起收集
                            else_depth = 0
                            else_started = False
                            while j < len(lines):
                                el = lines[j]
                                for ch in el:
                                    if ch == '{': else_depth += 1; else_started = True
                                    elif ch == '}': else_depth -= 1
                                loop_body.append(el)
                                j += 1
                                if else_started and else_depth == 0:
                                    break
                        break
                continue

            # free()
            free_m = re.search(rf'{stmt_var}\.free\(\)', next_line)
            if free_m:
                free_found = True
                j += 1
                continue

            # 如果上面都没匹配，停止前瞻
            break

        # 现在决定如何转换
        if step_pattern and row_var:
            if step_pattern == 'while':
                # → queryAll
                new_lines = []
                result_var = row_var + 's' if not row_var.endswith('s') else row_var
                if bind_params:
                    new_lines.append(f'  const {result_var} = await queryAll({sql_expr}, {bind_params})')
                else:
                    new_lines.append(f'  const {result_var} = await queryAll({sql_expr})')
                # 转换循环体：将 rows 循环替换原 while 循环
                new_lines.append(f'  for (const {row_var} of {result_var}) {{')
                # 添加循环体（去掉原花括号行）
                in_body = False
                for bl in loop_body:
                    stripped = bl.strip()
                    if stripped == '{':
                        in_body = True
                        continue
                    if stripped == '}':
                        in_body = False
                        continue
                    if in_body:
                        new_lines.append(bl)
                new_lines.append('  }')
                result.extend(new_lines)
                i = j
                continue

            elif step_pattern == 'if':
                # → queryOne
                new_lines = []
                if bind_params:
                    new_lines.append(f'  const {row_var} = await queryOne({sql_expr}, {bind_params})')
                else:
                    new_lines.append(f'  const {row_var} = await queryOne({sql_expr})')
                # 检查 if body 是否还有 else 分支
                # 简化处理：保留 if body 内容但去掉花括号和 getAsObject
                in_body = False
                in_else = False
                for bl in loop_body:
                    stripped = bl.strip()
                    if stripped == '{':
                        in_body = True
                        continue
                    if stripped == '}':
                        if in_body and not in_else:
                            in_body = False
                            continue
                        elif in_else:
                            in_else = False
                            continue
                    if re.match(r'\s*else\s*\{?\s*', bl):
                        in_else = True
                        new_lines.append(bl.replace('{', '').rstrip())
                        continue
                    if bl.strip().startswith('//') or bl.strip().startswith('/*'):
                        new_lines.append(bl)
                        continue
                    if in_body or in_else:
                        # remove getAsObject lines
                        if f'{row_var} = {stmt_var}.getAsObject()' in bl or f'const {row_var} = {stmt_var}.getAsObject()' in bl:
                            continue
                        if re.search(rf'{stmt_var}\.getAsObject\(\)', bl):
                            # 内联的 getAsObject: const r = stmt.getAsObject().xxx
                            bl = re.sub(rf'{stmt_var}\.getAsObject\(\)', row_var, bl)
                        new_lines.append(bl)

                # 加 if (row_var) 判断
                if not any('if (' + row_var + ')' in l for l in new_lines[-5:]):
                    # 在合适位置插入 if 判断
                    insert_at = 1  # 在 queryOne 之后
                    new_lines.insert(insert_at, f'  if ({row_var}) {{')
                    # 找到对应的闭合花括号
                    close_added = False
                    for idx in range(len(new_lines) - 1, -1, -1):
                        if new_lines[idx].strip() == '}':
                            new_lines.insert(idx + 1, '  }')
                            close_added = True
                            break

                result.extend(new_lines)
                i = j
                continue

        # 无法识别的模式，保留原样
        result.append(line)
        i += 1

    return '\n'.join(result)


def main():
    if not os.path.isdir(API_DIR):
        print(f"Error: {API_DIR} not found")
        sys.exit(1)

    count = 0
    for root, dirs, files in os.walk(API_DIR):
        for fname in files:
            if fname.endswith('.ts'):
                fpath = os.path.join(root, fname)
                if process_file(fpath):
                    count += 1

    if DRY_RUN:
        print(f"\n[DRY RUN] Would modify {count} files:")
        for f in changed_files:
            print(f"  {f}")
    else:
        print(f"\nModified {count} files.")
        for f in changed_files:
            print(f"  {f}")

    print(f"\nDone. {'DRY RUN — no files modified.' if DRY_RUN else ''}")


if __name__ == '__main__':
    main()
