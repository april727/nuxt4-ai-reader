"""
PDF → Markdown 解析器（带页码标记）
使用 pymupdf4llm 进行版面感知提取，保留标题层级、表格、阅读顺序。
需要：pip install pymupdf4llm
用法：python parse_pdf.py <pdf_path>

输出：Markdown 文本，其中每页起始位置插入 [PAGE:N] 标记。
标记不影响阅读——位于独立行，渲染时不可见，仅用于段落定位。
"""
import sys
import pymupdf4llm


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
        sys.exit(1)

    # 拼接 Markdown，每页起始插入页码标记
    parts: list[str] = []
    for chunk in chunks:
        page = chunk["metadata"]["page"]
        parts.append(f"[PAGE:{page}]")
        parts.append(chunk["text"])

    print("\n".join(parts))


if __name__ == "__main__":
    main()
