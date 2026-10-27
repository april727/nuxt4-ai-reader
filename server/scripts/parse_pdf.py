"""
PDF → Markdown + 章节结构化提取

- Markdown：pymupdf4llm 版面感知提取（保留段落、标题层级、表格、阅读顺序），
  每页起始位置插入 [PAGE:N] 标记（独立行，渲染时不可见，仅用于段落定位页码）。
- 章节：用 fitz（PyMuPDF）按「字号 + 关键词模式」识别章节/标题边界，
  输出结构化 JSON（方便目录 / 跳转），不依赖大模型。

需要：pip install pymupdf4llm（依赖 pymupdf，fitz 即 pymupdf）
用法：python parse_pdf.py <pdf_path>

输出（stdout，单行 JSON）：
{"markdown": "...", "chapters": [{"index":0,"title":"Chapter 1","level":1,"page":12}]}

失败：stderr 输出 "PDF_PARSE_ERROR: ..." 并以非 0 退出。
"""
import sys
import json
import re
from collections import Counter

import pymupdf4llm
import fitz  # pymupdf


# 章节级关键词：命中即视为标题行
CHAPTER_PAT = re.compile(
    r'^(chapter|chap\.?|part|book|section|prologue|epilogue|introduction|'
    r'preface|foreword|appendix|conclusion|afterword|contents|index)\b',
    re.IGNORECASE,
)
ROMAN_PAT = re.compile(r'^[IVXLC]+\.?$')


def detect_chapters(doc):
    """基于字号 + 关键词模式识别章节/标题层级，返回按阅读顺序排序的章节列表。

    层级约定：0 = Part/Book，1 = Chapter，2 = Section。
    正文字号 = 按字符数加权的众数字号；明显大于正文的短行视为标题。
    """
    # 1) 收集所有文本 span（带字号、粗体标志、坐标）
    span_rows = []
    for pno in range(doc.page_count):
        page = doc[pno]
        d = page.get_text("dict")
        for block in d.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span.get("text", "").strip()
                    if not text:
                        continue
                    span_rows.append({
                        "page": pno + 1,  # 1-based 页码
                        "y": span["bbox"][1],
                        "x": span["bbox"][0],
                        "size": span["size"],
                        "flags": span.get("flags", 0),
                        "text": text,
                    })

    if not span_rows:
        return []

    # 2) 正文字号 = 按字符数加权的众数
    size_counter = Counter()
    for s in span_rows:
        size_counter[round(s["size"], 1)] += len(s["text"])
    body_size = size_counter.most_common(1)[0][0]

    # 3) 按 (page, y) 聚合成行
    line_map = {}
    for s in span_rows:
        key = (s["page"], round(s["y"], 1))
        line_map.setdefault(key, []).append(s)

    lines = []
    for (page, y), ss in line_map.items():
        ss.sort(key=lambda s: s["x"])
        text = " ".join(s["text"] for s in ss).strip()
        max_size = max(s["size"] for s in ss)
        bold = any(s["flags"] & 16 for s in ss)
        lines.append({"page": page, "y": y, "text": text, "size": max_size, "bold": bold})
    # 阅读顺序：页内从上到下（y 递增）
    lines.sort(key=lambda l: (l["page"], l["y"]))

    # 4) 识别标题行并分级
    chapters = []
    seen_titles = set()
    for ln in lines:
        t = ln["text"]
        t_norm = re.sub(r'^[#\s]+', '', t).strip()
        if not t_norm or len(t_norm) > 120:
            continue

        m = CHAPTER_PAT.match(t_norm)
        kw = (m.group(1).lower() if m else '')
        if kw in ('part', 'book'):
            level = 0
        elif kw in ('chapter', 'chap', 'chap.', 'prologue', 'epilogue',
                    'introduction', 'preface', 'foreword', 'appendix',
                    'conclusion', 'afterword', 'contents', 'index'):
            level = 1
        elif kw == 'section':
            level = 2
        elif ln["size"] >= body_size * 1.45:
            level = 1
        elif ln["size"] >= body_size * 1.15 or (ln["bold"] and len(t_norm) < 60):
            level = 2
        else:
            continue

        key = t_norm.lower()
        if key in seen_titles:
            continue
        seen_titles.add(key)

        chapters.append({
            "index": len(chapters),
            "title": t_norm,
            "level": level,
            "page": ln["page"],
        })

    # 5) 兜底：无任何关键词命中时，用独立的罗马数字行（如 "I"、"II"）作为章节
    if not chapters:
        for ln in lines:
            t = ln["text"].strip()
            if ROMAN_PAT.match(t) and len(t) <= 8:
                chapters.append({"index": len(chapters), "title": t, "level": 1, "page": ln["page"]})
                if len(chapters) >= 40:
                    break

    return chapters


def main():
    if len(sys.argv) < 2:
        print("Usage: python parse_pdf.py <pdf_path>", file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    try:
        chunks = pymupdf4llm.to_markdown(pdf_path, page_chunks=True)
    except Exception as e:
        print(f"PDF_PARSE_ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    if not chunks:
        print("PDF_PARSE_ERROR: no chunks", file=sys.stderr)
        sys.exit(1)

    # 拼接 Markdown，每页起始插入页码标记
    parts = []
    for chunk in chunks:
        page = chunk["metadata"]["page"]
        parts.append(f"[PAGE:{page}]")
        parts.append(chunk["text"])
    markdown = "\n".join(parts)

    # 章节识别（失败不影响正文提取，降级为空列表）
    chapters = []
    try:
        doc = fitz.open(pdf_path)
        chapters = detect_chapters(doc)
        doc.close()
    except Exception:
        chapters = []

    # ensure_ascii=True：输出纯 ASCII（非 ASCII 转 \uXXXX），
    # 避免 Windows 下 Python stdout 用 cp936 编码导致 UnicodeEncodeError。
    print(json.dumps({"markdown": markdown, "chapters": chapters}))


if __name__ == "__main__":
    main()
