<template>
  <div class="reader-app">
    <!-- 顶部栏 -->
    <header class="reader-topbar" :class="{ 'topbar-hidden': topbarHidden, 'topbar-compact': topbarCompact }">
      <button class="back-btn" @click="goBack">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        书架
      </button>

      <div class="reader-title-center" :class="{ hidden: topbarCompact }">
        <span class="reader-doc-title">{{ title || '加载中…' }}</span>
      </div>

      <div class="reader-topbar-right">
        <!-- 手机端隐藏段落指示，给顶栏和正文留出空间 -->
        <div v-if="paragraphs.length && !topbarCompact" class="progress-wrap">
          <div class="progress-dots">
            <template v-for="item in visibleDots" :key="item.key">
              <span v-if="item.type === 'dot'" class="progress-dot" :class="{ done: item.index < currentParaIdx, current: paragraphs[item.index]?.id === activeParagraphId }" :title="`跳转到第 ${item.index + 1} 段`" @click="jumpToPara(item.index)" />
              <span v-else class="progress-gap">…</span>
            </template>
          </div>
          <span class="progress-text">第 {{ currentParaIdx + 1 }} 段 · 共 {{ paragraphs.length }} 段</span>
        </div>
        <div v-if="isProcessing || progressMsg" class="reader-progress-bar" :class="{ error: progressError }">
          <div v-if="isProcessing" class="mini-spinner"></div>
          <svg v-else-if="progressError" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="16 10 11 15 8 12"/></svg>
          <span>{{ progressMsg }}</span>
          <button v-if="progressError" class="progress-dismiss" @click="dismissProgress">×</button>
        </div>
        <!-- 功能按钮组：紧凑模式收进「⋯」下拉（带文字标签），宽屏横向排列 -->
        <div class="topbar-actions" :class="{ open: moreMenuOpen }">
        <button v-if="isVideo" class="reader-icon-btn" @click="goToWatch" title="回到播放模式">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
          </svg>
          <span class="tb-label">回到播放模式</span>
        </button>
        <button v-if="pdfUrl" class="reader-icon-btn" @click="pdfPage = null; showPdf = true" title="查看 PDF 原文">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
          <span class="tb-label">查看 PDF 原文</span>
        </button>
        <button v-if="readingPosition" class="reader-icon-btn" @click="jumpToReadingPos" title="阅读跳转">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <span class="tb-label">阅读跳转</span>
        </button>
        <button class="reader-icon-btn" @click="markCurrentPosition" title="标记位置">
          <span style="font-size:14px;line-height:1">🚩</span>
          <span class="tb-label">标记位置</span>
        </button>
        <button class="reader-icon-btn" :class="{ active: paraActionsEnabled }" @click="toggleParaActions" :title="paraActionsEnabled ? '隐藏段落工具条' : '显示段落工具条（悬停段落可编辑/插入/合并/删除）'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
          <span class="tb-label">段落工具条</span>
        </button>
        <button class="reader-icon-btn" @click="toggleSearch" title="搜索 (Ctrl+F)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <span class="tb-label">搜索</span>
        </button>
        <button v-if="chapters.length" class="reader-icon-btn" @click="tocVisible = true" title="章节目录">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
          <span class="tb-label">章节目录</span>
        </button>
        <button class="reader-icon-btn" @click="runManualAnalysis()" title="分析" :disabled="analyzing">
          <svg v-if="!analyzing" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/><path d="M8 12a4 4 0 1 1 8 0"/>
            <circle cx="12" cy="12" r="2.5"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/>
          </svg>
          <div v-else class="btn-spinner-sm"></div>
          <span class="tb-label">分析</span>
        </button>
        <button class="reader-icon-btn" @click="reimportOriginalText" title="重新导入" :disabled="segmenting || analyzing">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/>
          </svg>
          <span class="tb-label">重新导入</span>
        </button>
        <button class="reader-icon-btn" @click="openTrash" title="回收站" :class="{ 'has-trash': trashedMarks.length }">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
          </svg>
          <span class="tb-label">回收站</span>
        </button>
        <div class="segment-size-wrap" ref="segSizeWrapRef">
          <button class="reader-icon-btn" @click="toggleSegSizeMenu" title="重新分组" :disabled="segmenting">
            <svg v-if="!segmenting" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M4 7h16M4 12h12M4 17h8"/><circle cx="20" cy="17" r="3"/>
            </svg>
            <div v-else class="btn-spinner-sm"></div>
            <span class="tb-label">重新分组</span>
            <svg class="seg-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <Transition name="seg-drop">
            <div v-if="showSegSizeMenu" class="seg-size-menu">
              <template v-for="group in segSizeGroups" :key="group.key">
                <div class="seg-size-group-label">{{ group.label }}</div>
                <button
                  v-for="opt in group.options" :key="opt.key"
                  class="seg-size-opt" :class="{ active: segSizeKey === opt.key, 'is-disabled': opt.key === 'subtitle' && !isVideo }"
                  :disabled="opt.key === 'subtitle' && !isVideo"
                  :title="opt.key === 'subtitle' && !isVideo ? '仅视频/音频（有字幕）可用' : ''"
                  @click="selectSegSize(opt)"
                >
                  <span class="seg-size-label">{{ opt.label }}</span>
                  <span class="seg-size-hint">{{ opt.hint }}</span>
                </button>
                <!-- 简单分段的句数选择 -->
                <div v-if="group.key === 'simple' && segSizeKey === 'simple'" class="seg-size-simple">
                  <span class="seg-size-simple-label">每段句数</span>
                  <div class="seg-size-simple-opts">
                    <button
                      v-for="n in simpleSentencesOptions" :key="n"
                      class="seg-size-simple-opt" :class="{ active: simpleSentences === n }"
                      @click.stop="simpleSentences = n; selectSegSize({ key: 'simple', label: '简单' })"
                    >{{ n }}</button>
                  </div>
                </div>
              </template>
            </div>
          </Transition>
        </div>
        </div>
        <!-- 手机端「⋯」：展开/收起功能下拉 -->
        <button v-if="topbarCompact" class="reader-icon-btn topbar-more-btn" :class="{ active: moreMenuOpen }" @click="moreMenuOpen = !moreMenuOpen" title="更多功能">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/>
          </svg>
          <span class="more-label">功能</span>
          <svg class="more-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <!-- 收起菜单栏：向上隐藏，释放正文空间 -->
        <button class="reader-icon-btn topbar-collapse-btn" @click="topbarHidden = true" title="收起菜单栏">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="18 15 12 9 6 15"/>
          </svg>
        </button>
      </div>
    </header>

    <!-- 菜单栏收起后：右上角悬浮恢复按钮 -->
    <button v-if="topbarHidden" class="topbar-restore" @click="topbarHidden = false" title="展开菜单栏">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>

    <!-- 书内搜索条 -->
    <div v-if="searchVisible" class="search-bar">
      <div class="search-bar-inner">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="search-bar-icon">
          <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
        </svg>
        <input
          ref="searchInputRef"
          v-model="searchText"
          class="search-bar-input"
          placeholder="搜索文章内容…"
          @input="doSearch"
          @keydown.enter="nextMatch"
          @keydown.escape="searchVisible = false"
        />
        <span v-if="searchText" class="search-bar-count">{{ searchMatches?.length ? `${currentMatchIdx + 1}/${searchMatches.length}` : '0' }}</span>
        <button v-if="searchText" class="search-bar-nav" @click="prevMatch" :disabled="!searchMatches?.length">▲</button>
        <button v-if="searchText" class="search-bar-nav" @click="nextMatch" :disabled="!searchMatches?.length">▼</button>
        <button class="search-bar-close" @click="searchVisible = false">×</button>
      </div>
    </div>

    <div class="reader-body" ref="readerBodyEl">
      <!-- 正文区 -->
      <article class="reader-article-pane" ref="articlePane">
        <template
          v-for="(para, index) in paragraphs"
          :key="para.id"
        >
        <!-- 在段落上方插入 -->
        <div
          v-if="insertingPosition?.paragraphId === para.id && insertingPosition?.position === 'before'"
          class="insert-block" @click.stop
        >
          <textarea
            :ref="(el: any) => { insertTextareaEl = el }"
            class="para-edit-area"
            v-model="insertText"
            :placeholder="`在「段落 ${index + 1}」上方插入自定义内容…`"
            @keydown.escape="cancelInsert"
            @keydown.ctrl.enter="confirmInsert"
            @input="autoResizeInsertTextarea"
            :rows="insertRows"
          ></textarea>
          <div class="insert-actions">
            <button class="btn-cancel" @click="cancelInsert">取消</button>
            <button class="btn-confirm" @click="confirmInsert">确认插入</button>
          </div>
        </div>

        <div
          :data-id="para.id"
          class="para-block"
          :class="{ active: para.id === activeParagraphId, hovered: para.id === hoveredParaId && para.id !== activeParagraphId, past: para.id < activeParagraphId }"
          :ref="el => { if (el) paraRefs[index] = el }"
          @mouseenter="cancelParaHide(); hoveredParaId = para.id"
          @mouseleave="scheduleParaHide()"
          @click="handleParaClick(para, $event)"
          @mouseup="handleTextSelect(para)"
          @dblclick="handleDoubleClick(para)"
        >
          <div
            class="para-num"
            :class="{ 'pos-marker': readingPosition?.paragraphId === para.id, 'has-chat': paragraphsWithChats.has(para.id), 'has-note': hasParaNote(para.id), 'is-video': isVideo }"
            @click.stop="handleSetPosition(para.id)"
            :title="readingPosition?.paragraphId === para.id ? '当前阅读位置' : '点击标记阅读位置'"
          >
            <template v-if="isVideo && (para as any).start !== undefined">{{ formatCueTime((para as any).start) }}</template>
            <template v-else>{{ index + 1 }}</template>
          </div>
          <div class="para-body">
            <!-- 展示模式 -->
            <div v-if="editingParagraphId !== para.id" class="para-text" v-html="renderMarkedText(para)"></div>
            <!-- 编辑模式 -->
            <template v-else>
              <textarea
                v-if="!editPreview"
                :ref="(el: any) => { editTextareaEl = el }"
                class="para-edit-area"
                v-model="editText"
                @keydown.escape="cancelEdit"
                @keydown.ctrl.enter="saveEdit(para.id)"
                @input="autoResizeEditTextarea"
                :rows="editRows"
                placeholder="支持 Markdown：# 标题、**加粗**、- 列表、空行分段…"
              ></textarea>
              <div
                v-else
                class="para-edit-preview"
                v-html="renderEditPreview()"
              ></div>
            </template>
          <div class="para-actions" v-if="paraActionsEnabled && (para.id === activeParagraphId || para.id === hoveredParaId)" @click.stop @mouseenter="cancelParaHide()" @mouseleave="scheduleParaHide()">
            <button
              v-if="isVideo && (para as any).start !== undefined"
              class="para-action-btn"
              @click.stop="playSegment(para)"
              :title="miniPlayerVisible && miniPlayerStart === (para as any).start ? '重新播放本段' : '播放本段'"
            >
              <!-- 播放中：音频波形动画 -->
              <span v-if="miniPlayerPlaying && miniPlayerStart === (para as any).start" class="playing-bars">
                <span v-for="i in 3" :key="i" class="playing-bar" :style="{ animationDelay: (i * 0.15) + 's' }"></span>
              </span>
              <!-- 暂停 / 未播放：三角 -->
              <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polygon points="5,3 19,12 5,21"/>
              </svg>
            </button>
            <button
              v-if="editingParagraphId === para.id"
              class="para-action-btn edit-confirm"
              @click.stop="saveEdit(para.id)"
              title="确认修改"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </button>
            <button
              v-if="editingParagraphId === para.id"
              class="para-action-btn"
              :class="{ active: editPreview }"
              @click.stop="editPreview = !editPreview"
              :title="editPreview ? '编辑源码' : '预览效果'"
            >
              <svg v-if="!editPreview" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5m-1.41-9.82a2 2 0 1 1 2.83 2.83L11 15l-4 1 1-4 9.55-9.55z"/></svg>
            </button>
            <button
              v-else
              class="para-action-btn"
              @click.stop="startEdit(para.id)"
              title="编辑"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
              </svg>
            </button>
            <button
              class="para-action-btn"
              @click.stop="startInsert('before', para.id)"
              title="在上方插入段落"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <line x1="12" y1="5" x2="12" y2="19"/><polyline points="8 9 12 5 16 9"/><line x1="5" y1="3" x2="19" y2="3"/>
              </svg>
            </button>
            <button
              class="para-action-btn"
              @click.stop="startInsert('after', para.id)"
              title="在下方插入段落"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <line x1="12" y1="5" x2="12" y2="19"/><polyline points="16 15 12 19 8 15"/><line x1="5" y1="21" x2="19" y2="21"/>
              </svg>
            </button>
            <button
              v-if="index < paragraphs.length - 1"
              class="para-action-btn"
              @click.stop="mergeWithBelow(para.id)"
              title="与下方段落合并"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M8 6h8M8 10h8M8 14h4"/><path d="M8 18l4-4 4 4"/><line x1="8" y1="18" x2="16" y2="18"/>
              </svg>
            </button>
            <button class="para-action-btn" @click.stop="focusChatInput" title="快捷提问">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                <line x1="9" y1="10" x2="15" y2="10"/>
                <line x1="12" y1="7" x2="12" y2="13"/>
              </svg>
            </button>
            <button
              class="para-action-btn"
              :class="{ 'copy-success': copiedParaId === para.id }"
              @click.stop="doCopy(para.text, para.id)"
              :title="copiedParaId === para.id ? '已复制' : '复制'"
            >
              <svg v-if="copiedParaId === para.id" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
            <button
              v-if="pdfUrl && !isVideo"
              class="para-action-btn"
              @click.stop="openPdfAtParagraph(para)"
              title="在原文中定位"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
            </button>
            <button class="para-action-btn" @click.stop="cleanParagraph(para.id, para.text)" title="整理内容" :disabled="cleaningPara === para.id">
              <div v-if="cleaningPara === para.id" class="mini-spinner-inline"></div>
              <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/><path d="M17 4l3 3-3 3"/><path d="M21 7H9"/>
              </svg>
            </button>
            <button class="para-action-btn" @click.stop="handleParagraphAction('explain', para.id, para.text)" title="AI 翻译此段">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>
            </button>
            <button class="para-action-btn" @click.stop="reAnalyzeParagraph(para.id, para.text)" title="重新分析">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>
            <button class="para-action-btn" @click.stop="insertImageForParagraph(para.id)" title="插入图片">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
              </svg>
            </button>
            <button class="para-action-btn" @click.stop="showAppearance = !showAppearance" title="阅读外观">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
            <button class="para-action-btn para-action-btn--delete" @click.stop="deleteParagraph(para.id)" title="删除段落">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
              </svg>
            </button>
          </div>
          <!-- 段落关联图片 -->
          <div v-if="(para as any).images?.length" class="para-images" :class="`para-images--${paraImageSize(para.id)}`">
            <div class="para-images-bar">
              <button class="para-images-toggle" @click.stop="toggleParaImages(para.id)" :title="isParaImagesCollapsed(para.id) ? '展开图片' : '收起图片'">
                <svg class="pi-chevron" :class="{ open: !isParaImagesCollapsed(para.id) }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
                {{ (para as any).images.length }} 张
              </button>
              <div class="para-images-size">
                <button :class="{ active: paraImageSize(para.id) === 'sm' }" @click.stop="setParaImageSize(para.id, 'sm')" title="小">◉</button>
                <button :class="{ active: paraImageSize(para.id) === 'md' }" @click.stop="setParaImageSize(para.id, 'md')" title="中">◉</button>
                <button :class="{ active: paraImageSize(para.id) === 'lg' }" @click.stop="setParaImageSize(para.id, 'lg')" title="大">◉</button>
              </div>
            </div>
            <div v-if="!isParaImagesCollapsed(para.id)" v-for="(img, i) in (para as any).images" :key="i" class="para-image-wrap">
              <img :src="`/api/file/${img}`" :alt="`段落图片 ${i + 1}`" @click.stop="viewImage(`/api/file/${img}`)" />
              <button class="para-image-del" @click.stop="removeParaImage(para.id, img)" title="删除图片">×</button>
            </div>
          </div>
          </div>
          <!-- 阅读位置小红旗 -->
          <span
            v-if="flagPos && flagPos.pid === para.id"
            class="pos-flag"
            :style="{ left: flagPos.x + 'px', top: flagPos.y + 'px' }"
            :title="readingPosition?.selectedText ? `上次读到：「${readingPosition.selectedText}」` : '上次阅读位置'"
          >🚩</span>
        </div>

        <!-- 在段落下方插入 -->
        <div
          v-if="insertingPosition?.paragraphId === para.id && insertingPosition?.position === 'after'"
          class="insert-block" @click.stop
        >
          <textarea
            :ref="(el: any) => { insertTextareaEl = el }"
            class="para-edit-area"
            v-model="insertText"
            :placeholder="`在「段落 ${index + 1}」下方插入自定义内容…`"
            @keydown.escape="cancelInsert"
            @keydown.ctrl.enter="confirmInsert"
            @input="autoResizeInsertTextarea"
            :rows="insertRows"
          ></textarea>
          <div class="insert-actions">
            <button class="btn-cancel" @click="cancelInsert">取消</button>
            <button class="btn-confirm" @click="confirmInsert">确认插入</button>
          </div>
        </div>
        </template>
      </article>

      <!-- 阅读赛道（把中间闲置分隔缝做成游戏竖条，移动端隐藏） -->
      <GameRail
        :current-para-idx="currentParaIdx"
        :total-paras="paragraphs.length"
        :marked-count="activeMarkedWordCount"
        :hidden="isMobile"
      />

      <!-- 可拖拽分割线（移动端隐藏） -->
      <div class="panel-divider" :class="{ hidden: isMobile }"></div>

      <!-- 右侧面板 -->
      <aside class="reader-panel" :class="{ hidden: !isMobile && !showAnalysisPanel, 'panel-bottom': true, 'panel-bottom--expanded': panelExpanded }" :style="isMobile ? { width: '100%' } : {}">
        <!-- 面板推拉按钮（宽屏用） -->
        <div class="panel-toggle" @click="toggleAnalysisPanel" :title="showAnalysisPanel ? '隐藏面板' : '展开面板'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline v-if="showAnalysisPanel" points="15 18 9 12 15 6"/>
            <polyline v-else points="9 18 15 12 9 6"/>
          </svg>
        </div>

        <!-- 窄屏底部横条 -->
        <div
          class="panel-bottom-bar"
          @touchstart.passive="onPanelResizeStart"
        >
          <!-- 桌面端拖拽上边缘 -->
          <div class="panel-drag-edge" @mousedown.prevent="onPanelResizeStart"></div>
          <div class="panel-bottom-tabs">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              class="panel-bottom-tab"
              :class="{ active: activeTab === tab.key }"
              @click="activeTab = tab.key"
            >{{ tab.label }}</button>
          </div>
          <div class="panel-bottom-right">
            <div class="panel-bottom-chevron-wrap" @click="togglePanelExpand" :title="panelExpanded ? '收起面板' : '展开面板'">
              <svg class="panel-bottom-chevron" :class="{ open: panelExpanded }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          </div>
        </div>

        <div class="panel-inner" :style="panelExpanded ? { height: panelHeight + 'px' } : {}">
          <div class="panel-tabs">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              class="tab-btn"
              :class="{ active: activeTab === tab.key }"
              @click="activeTab = tab.key"
            >{{ tab.label }}</button>
          </div>

        <!-- 理解 Tab -->
        <div v-if="activeTab === 'understand'" class="panel-content qa-panel">
          <div class="panel-scroll">
            <section class="panel-section" v-if="activeParagraphId || rightPanelContent || isTyping || displayedContent">
              <div class="section-header">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                段落解析
                <button
                  v-if="activeParagraphId"
                  class="ai-translate-btn"
                  :disabled="pendingExplain === activeExplainPid"
                  @click="explainCurrentParagraph"
                  :title="pendingExplain === activeExplainPid ? '正在生成…' : 'AI 翻译并解析当前段落'"
                >{{ pendingExplain === activeExplainPid ? '生成中…' : 'AI 翻译此段' }}</button>
                <button
                  v-if="paragraphs.length"
                  class="ea-btn"
                  :disabled="explainAll.running"
                  @click="startExplainAll"
                  :title="explainAll.running ? '正在后台生成…' : '解释当前文章所有未解析段落'"
                >{{ explainAll.running ? `生成中 ${explainAll.done}/${explainAll.total}` : '解释全文' }}</button>
              </div>

              <!-- 段落选中：Markdown 编辑器（编辑/显示切换） -->
              <template v-if="activeParagraphId">
                <div class="source-preview-tabs">
                  <button
                    class="sp-tab-btn"
                    :class="{ active: explainViewTab === 'edit' }"
                    @click="switchExplainView('edit')"
                  >编辑</button>
                  <button
                    class="sp-tab-btn"
                    :class="{ active: explainViewTab === 'view' }"
                    @click="switchExplainView('view')"
                  >显示</button>
                </div>

                <!-- 编辑模式：可编辑 Markdown 源码 -->
                <div v-if="explainViewTab === 'edit'" class="section-text">
                  <textarea
                    ref="explainEditorEl"
                    class="source-editor"
                    v-model="explainSourceContent"
                    :disabled="pendingExplain === activeExplainPid"
                    spellcheck="false"
                    placeholder="支持 Markdown；可直接 Ctrl+V 粘贴图片"
                    @input="explainManuallyEdited = true"
                    @paste="onExplainEditorPaste"
                    @blur="saveExplanationContent"
                  ></textarea>
                  <div v-if="pendingExplain === activeExplainPid" class="explain-loading">
                    <div class="explain-spinner"></div>
                    <span>正在生成翻译…</span>
                  </div>
                </div>

                <!-- 显示模式：渲染预览 -->
                <div v-else class="section-text">
                  <template v-if="explainParsed && !explainManuallyEdited">
                    <div class="trans-section">
                      <div class="trans-title">一、整体翻译</div>
                      <div class="trans-para" v-html="transRenderedHtml"></div>
                    </div>
                    <MarkdownRenderer :content="explainBodyMarkdown" :is-streaming="false"/>
                  </template>
                  <template v-else-if="pendingExplain === activeExplainPid">
                    <div v-if="transParaHtml" class="trans-section">
                      <div class="trans-title">一、整体翻译</div>
                      <div class="trans-para" v-html="transRenderedHtml"></div>
                    </div>
                    <div v-else class="explain-loading">
                      <div class="explain-spinner"></div>
                      <span>正在生成翻译…</span>
                    </div>
                  </template>
                  <MarkdownRenderer
                    v-else
                    :content="explainSourceContent"
                    :is-streaming="false"
                    image-resizable
                    @resize-image="onExplainImageResize"
                  />
                </div>
              </template>

              <!-- 其他操作（翻译等）：直接渲染 -->
              <div v-else class="section-text">
                <MarkdownRenderer v-if="displayedContent || rightPanelContent" :content="displayedContent || rightPanelContent" :is-streaming="isTyping"/>
                <span v-if="isTyping" class="typing-cursor">|</span>
              </div>
            </section>

            <div v-if="!activeParagraphId && !rightPanelContent && !isTyping && !displayedContent" class="empty-state">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <p>点击段落，可在此输入翻译或用「AI 翻译此段」</p>
            </div>
          </div>

          <!-- 问答区 -->
          <div class="qa-toggle" @click="qaVisible = !qaVisible">
            <span class="qa-toggle-label">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              与 AI 讨论段落内容
            </span>
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              class="qa-chevron" :class="{ open: qaVisible }"
            ><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <Transition name="qa-slide">
            <div v-if="qaVisible" class="qa-area" ref="qaAreaRef">
            <!-- 顶部操作栏 -->
            <div class="qa-top-bar">
              <div v-if="hasAnswerContent" class="qa-resize-handle" @mousedown.prevent="startQaResize"></div>
              <button class="qa-collapse-btn" @click.stop="qaVisible = false" title="收起">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 15 12 9 18 15"/></svg>
              </button>
            </div>
            <!-- 快捷提问 -->
            <div v-if="currentParagraphChat.length === 0 && !chatLoading && !chatTyping" class="qa-quick">
              <button
                v-for="q in quickQuestions" :key="q.label"
                class="qa-quick-btn"
                :disabled="chatLoading"
                @click="sendQuick(q.prompt)"
              >{{ q.label }}</button>
            </div>
            <!-- 回答区 -->
            <div class="qa-answer" ref="qaAnswerRef" :style="qaAnswerStyle">
              <div
                v-for="(msg, i) in currentParagraphChat"
                :key="i"
                class="chat-msg"
                :class="[msg.role, { 'has-bookmark': msg.role === 'assistant' }]"
              >
                <div class="chat-bubble"><MarkdownRenderer :content="msg.content" /></div>
                <button
                  v-if="msg.role === 'assistant'"
                  class="chat-bookmark-btn"
                  :class="{ saved: savedMessages.has(i) }"
                  @click.stop="saveAiMessage(msg.content, i)"
                  :title="savedMessages.has(i) ? '已收藏' : '收藏此回答'"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                </button>
              </div>
              <!-- 流式输出中 -->
              <div v-if="chatTyping" class="chat-msg ai">
                <div class="chat-bubble"><MarkdownRenderer :content="typingChatContent" :is-streaming="true" /><span class="typing-cursor">|</span></div>
              </div>
              <div v-else-if="chatLoading && !chatTyping" class="chat-msg ai">
                <div class="chat-bubble" style="color:#a09e97">思考中…</div>
              </div>
            </div>
            <!-- 提问输入框 -->
            <div class="qa-input-row">
              <input
                ref="chatInputEl"
                class="chat-input"
                v-model="chatInput"
                placeholder="提问关于当前段落的问题…"
                @keydown.enter="sendChat"
                :disabled="chatLoading"
              />
              <button class="send-btn" @click="sendChat" :disabled="!chatInput.trim() || chatLoading">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </div>
          </Transition>
        </div>

        <!-- 笔记 Tab -->
        <div v-if="activeTab === 'notes'" class="panel-content">
          <div class="panel-scroll notes-panel">
            <!-- 当前段落笔记（跟随段落，每段独立保存，富文本可插图片） -->
            <section class="panel-section" v-if="activeParagraphId">
              <div class="section-header">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M4 21V4h11l5 5v12z"/><polyline points="14 4 14 10 20 10"/>
                </svg>
                段落笔记
                <span class="note-para-chip">第 {{ currentParaIdx + 1 }} 段</span>
              </div>
              <div class="notes-editor-wrap note-editor--para" :key="'para-note-' + (activeParagraphId || 'none')">
                <RichEditor v-model="currentParagraphNote" placeholder="为当前段落写笔记，可插入图片…" @blur="saveParaNotes" />
              </div>
            </section>
            <div v-else class="empty-state">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M4 21V4h11l5 5v12z"/><polyline points="14 4 14 10 20 10"/>
              </svg>
              <p>点击段落，为它写笔记（每段独立保存）</p>
            </div>

            <!-- 已有笔记的段落索引 -->
            <div v-if="paraNoteList.length" class="notes-divider">
              <span>已有笔记 · {{ paraNoteList.length }} 段</span>
            </div>
            <div
              v-for="item in paraNoteList" :key="item.pid"
              class="note-card note-card--index"
              @click="jumpToNote(item.pid)"
            >
              <div class="note-quote">
                <span class="note-para-label">第 {{ paragraphIndex(item.pid) }} 段</span>
                <span class="note-preview-text">{{ item.preview }}</span>
                <button class="note-jump-btn" @click.stop="jumpToNote(item.pid)" title="跳转到段落">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </button>
              </div>
            </div>

            <!-- 历史摘抄（旧版选中文字生成，保留展示不丢数据） -->
            <template v-if="paragraphNotes.length">
              <div class="notes-divider">
                <span>历史摘抄 · {{ paragraphNotes.length }}</span>
              </div>
              <div v-for="(note, ni) in paragraphNotes" :key="note.id" class="note-card">
                <div class="note-quote">
                  <svg class="note-quote-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" opacity="0.3"><path d="M3.7 6.7C2.4 8.3 1.5 10.4 1.5 12.9c0 4.2 2.1 5.6 3.9 5.6 2.2 0 3.5-1.8 3.5-3.5s-1.3-3.5-3.5-3.5c-.2 0-.5 0-.7.1.4-1.5 1.3-2.8 2.6-3.8L3.7 6.7zm9.5 0c-1.3 1.6-2.2 3.7-2.2 6.2 0 4.2 2.1 5.6 3.9 5.6 2.2 0 3.5-1.8 3.5-3.5s-1.3-3.5-3.5-3.5c-.2 0-.5 0-.7.1.4-1.5 1.3-2.8 2.6-3.8l-3.6-1.1z"/></svg>
                  <span class="note-quote-text">{{ note.quotedText }}</span>
                  <button class="note-jump-btn" @click.stop="jumpToNoteSource(note)" title="跳转到原文位置">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  </button>
                </div>
                <div class="note-actions">
                  <span class="note-para-label">第 {{ paragraphIndex(note.paragraphId) }} 段</span>
                  <button class="note-action-btn note-action-btn--delete" @click.stop="deleteNote(ni)" title="删除">删除</button>
                </div>
              </div>
            </template>

          </div>
        </div>

        <!-- 生词 Tab -->
        <div v-if="activeTab === 'vocab'" class="panel-content">
          <div class="panel-scroll">
            <div v-if="savedVocab.length === 0" class="empty-state">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              </svg>
              <p>标记的生词会显示在这里</p>
            </div>
            <div v-for="word in savedVocab" :key="word.text" class="vocab-card">
              <div class="vocab-word">{{ word.text }}</div>
              <div class="vocab-phonetic">{{ word.phonetic }}</div>
              <div class="vocab-meaning">{{ word.meaning }}</div>
              <button class="vocab-pronounce" @click.stop="article.pronounceWord(word.text)" title="发音">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
        </div><!-- /.panel-inner -->
      </aside>
    </div>

    <!-- 选中文字浮动标记工具条（词/短/句/译） -->
    <Teleport to="body">
      <div v-if="selToolbar.visible" class="sel-toolbar" :style="selToolbarStyle">
        <button class="sel-btn" style="--c:#f59e0b" @click="createMark('word')" title="标记为生词">
          <span class="sel-label">词</span><span class="sel-hint">标记</span>
        </button>
        <button class="sel-btn" style="--c:#10b981" @click="createMark('phrase')" title="标记为短语">
          <span class="sel-label">短</span><span class="sel-hint">标记</span>
        </button>
        <button class="sel-btn" style="--c:#06b6d4" @click="createMark('sentence')" title="标记为句子">
          <span class="sel-label">句</span><span class="sel-hint">标记</span>
        </button>
        <button class="sel-btn" style="--c:#8b5cf6" @click="handleQuickTranslate(selToolbar.text, { x: selToolbar.x, y: selToolbar.y }); selToolbar.visible = false; selToolbar.hasSelection = false; window.getSelection()?.removeAllRanges()" title="翻译选中">
          <span class="sel-label">译</span><span class="sel-hint">翻译</span>
        </button>
      </div>
    </Teleport>

    <!-- 浮动翻译卡片 -->
    <TranslateCard
      :visible="tc.visible"
      :text="tc.text"
      :loading="tc.loading"
      :position="tc.position"
      @close="tc.visible = false"
    />

    <!-- 标记详情弹窗 -->
    <!-- 文本外观设置 -->
    <ReadingAppearance :visible="showAppearance" @close="showAppearance = false" />

    <!-- 全局知识要点按钮（排除段落正文区） -->
    <GlobalKnowledgeBtn :source-id="id" :source-title="title || article.analysis.value?.title || ''" />

    <MarkPopup
      :visible="markPopup.visible"
      :mark="markPopup.mark"
      :text-id="id"
      :loading="markPopup.loading"
      :typing="markPopup.typing"
      :typing-content="markPopup.typingContent"
      :position="markPopup.position"
      :auto-generate="markAutoGenerate"
      @close="markPopup.visible = false"
      @update-note="handleUpdateNote"
      @update-detail="handleUpdateDetail"
      @generate="handleGenerateMarkDetail"
      @update-auto-generate="setMarkAutoGenerate"
      @delete="handleDeleteMark"
      @pronounce="handlePronounce"
    />

    <!-- PDF 查看 -->
    <div v-if="showPdf && pdfUrl" class="pdf-overlay" @click.self="showPdf = false">
      <div class="pdf-viewer">
        <div class="pdf-viewer-header"><span>PDF 原文</span><button class="modal-close" @click="showPdf = false">&times;</button></div>
        <iframe :src="pdfViewerUrl" class="pdf-iframe" frameborder="0"></iframe>
      </div>
    </div>

    <!-- 迷你播放条（字幕阅读页底部） -->
    <MiniPlayer
      v-if="videoMeta"
      ref="miniPlayerRef"
      :src="videoMeta.url"
      :file-type="videoMeta.type"
      :visible="miniPlayerVisible"
      :start-time="miniPlayerStart"
      :end-time="miniPlayerEnd"
      :force-replay="forceReplayKey"
      @close="miniPlayerVisible = false"
    />

    <FloatingImage
      v-if="floatingImage"
      :src="floatingImage.src"
      :title="floatingImage.title"
      @close="floatingImage = null"
    />

    <!-- 手动分段 / 播客整理上传 -->
    <Teleport to="body">
      <div v-if="manualSegVisible" class="manual-seg-overlay" @click.self="manualSegVisible = false">
        <div class="manual-seg-modal">
          <div class="manual-seg-header">
            <span>手动分段 / 整理上传</span>
            <button class="manual-seg-close" @click="manualSegVisible = false" title="关闭">×</button>
          </div>
          <div class="manual-seg-body">
            <label class="manual-seg-label">分段内容（<b>空行分隔</b>，每块 = 一个段落）</label>
            <textarea
              class="manual-seg-textarea"
              v-model="manualSegText"
              spellcheck="false"
              placeholder="粘贴已分好段的内容，段与段之间用空行隔开…"
            ></textarea>
            <div class="manual-seg-count">
              {{ manualSegCount }} 个段落
              <span v-if="manualSegCount === 0" class="manual-seg-warn">需用空行分隔</span>
            </div>

            <label class="manual-seg-label">整理笔记（可选，播客/博客用 Markdown，同步到知识要点）</label>
            <textarea
              class="manual-seg-textarea manual-seg-notes"
              v-model="manualNotesText"
              spellcheck="false"
              placeholder="## 情景对话原文&#10;…&#10;&#10;## 重点词汇表&#10;…"
            ></textarea>

            <div v-if="manualSegError" class="manual-seg-error">{{ manualSegError }}</div>
          </div>
          <div class="manual-seg-footer">
            <button class="manual-seg-btn manual-seg-cancel" @click="manualSegVisible = false">取消</button>
            <button
              class="manual-seg-btn manual-seg-save"
              :disabled="manualSegSaving || manualSegCount === 0"
              @click="saveManualSegments"
            >{{ manualSegSaving ? '保存中…' : '保存并应用' }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 按字幕条数分段 -->
    <Teleport to="body">
      <div v-if="subtitleSegVisible" class="manual-seg-overlay" @click.self="subtitleSegVisible = false">
        <div class="manual-seg-modal" style="max-width: 380px">
          <div class="manual-seg-header">
            <span>按字幕条数分段</span>
            <button class="manual-seg-close" @click="subtitleSegVisible = false" title="关闭">×</button>
          </div>
          <div class="manual-seg-body">
            <label class="manual-seg-label">每段包含多少条字幕？</label>
            <input
              type="number"
              class="manual-seg-input"
              v-model.number="subtitleSegCount"
              min="1"
              max="200"
              placeholder="例如 10"
              @keydown.enter="confirmSubtitleSeg"
              @focus="$event.target.select()"
            />
            <div class="manual-seg-count">
              共 {{ originalSubtitles?.length || 0 }} 条字幕 → 约 {{ Math.ceil((originalSubtitles?.length || 0) / Math.max(1, subtitleSegCount || 10)) }} 段
            </div>
            <label class="manual-seg-check">
              <input type="checkbox" v-model="subtitlePunctuate" class="manual-seg-checkbox" />
              <span>自动补标点（每条字幕首字母大写 + 句号）</span>
            </label>
          </div>
          <div class="manual-seg-footer">
            <button class="manual-seg-btn manual-seg-cancel" @click="subtitleSegVisible = false">取消</button>
            <button class="manual-seg-btn manual-seg-save" @click="confirmSubtitleSeg">分段</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 标记回收站 -->
    <Teleport to="body">
      <div v-if="trashVisible" class="modal-overlay" @click.self="trashVisible = false">
        <div class="modal-card trash-modal">
          <div class="modal-header">
            <h3 class="modal-title">标记回收站</h3>
            <button class="modal-close" @click="trashVisible = false">×</button>
          </div>
          <div class="modal-body trash-body">
            <p v-if="trashedMarks.length === 0" class="trash-empty">回收站是空的</p>
            <div v-for="m in trashedMarks" :key="m.id" class="trash-item">
              <div class="trash-item-info">
                <div class="trash-item-text">{{ m.text }}</div>
                <div class="trash-item-meta">{{ markTypeLabel(m.type) }} · {{ formatTrashTime(m.deletedAt) }}</div>
              </div>
              <div class="trash-item-actions">
                <button class="trash-restore-btn" @click="restoreMark(m)">恢复</button>
                <button class="trash-delete-btn" @click="permanentDeleteMark(m)">彻底删除</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 章节目录 -->
    <Teleport to="body">
      <div v-if="tocVisible" class="modal-overlay" @click.self="tocVisible = false">
        <div class="modal-card toc-modal">
          <div class="modal-header">
            <h3 class="modal-title">目录</h3>
            <button class="modal-close" @click="tocVisible = false">×</button>
          </div>
          <div class="modal-body toc-body">
            <p v-if="chapters.length === 0" class="trash-empty">未识别到章节</p>
            <button
              v-for="(ch, i) in chapters"
              :key="`${ch.title}-${i}`"
              class="toc-item"
              :class="{ 'toc-level-0': ch.level === 0, 'toc-level-2': ch.level === 2 }"
              @click="jumpToChapter(i)"
            >
              <span class="toc-item-title">{{ ch.title }}</span>
              <span class="toc-item-page">p.{{ ch.page }}</span>
            </button>
          </div>
        </div>
      </div>
    </Teleport>

  </div>
</template>

<script setup lang="ts">
import type { ParagraphAction, ChatMessage, Paragraph, Mark, MarkType, ReadingPosition, ParagraphNote, Chapter } from '#shared/types'
import { MARK_COLORS } from '#shared/types'
import { useArticle } from '~/composables/useArticle'
import { useDeepSeek } from '~/composables/useDeepSeek'
import { useTextStream } from '~/composables/useTextStream'
import { useIsMobile } from '~/composables/useIsMobile'
import MarkdownRenderer from '~/components/MarkdownRenderer.vue'
import ReadingAppearance from '~/components/ReadingAppearance.vue'
import GlobalKnowledgeBtn from '~/components/GlobalKnowledgeBtn.vue'
import { compressImageFile } from '~/utils/imageCompress'
import { marked } from 'marked'
import { parseExplainJson, parseExplainMarkdown, renderExplainMarkdown, renderExplainBody, setMarkdownImageWidth, type ExplainJson } from '#shared/utils/explainRenderer'

const route = useRoute(); const id = route.params.id as string
useHead({ title: 'AI 阅读分析' })

const article = useArticle(); const deepseek = useDeepSeek(); const textStream = useTextStream()
const chatTextStream = useTextStream()
const { rawText, title, paragraphs, analysis, chatHistory, activeParagraphId, rightPanelContent, isProcessing, currentParagraphChat } = article

const videoSources = ['youtube', 'bilibili', 'video_file', 'audio_file']
const isMobile = useIsMobile()

// 顶栏收起/展开（记忆到 localStorage）
const topbarHidden = ref(false)
onMounted(() => { try { topbarHidden.value = localStorage.getItem('reader-topbar-hidden') === '1' } catch {} })
watch(topbarHidden, (v) => { try { localStorage.setItem('reader-topbar-hidden', v ? '1' : '0') } catch {} })

// 手机端「⋯」更多功能下拉
const moreMenuOpen = ref(false)
// 顶栏紧凑模式：窗口不足 1152px（或触屏设备）时，功能按钮收进「⋯」下拉，标题/段落进度隐藏
const topbarCompact = ref(false)
function syncTopbarCompact() {
  if (typeof window === 'undefined') return
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false
  topbarCompact.value = window.innerWidth < 1152 || coarse
}
onMounted(() => { syncTopbarCompact(); window.addEventListener('resize', syncTopbarCompact) })
onBeforeUnmount(() => window.removeEventListener('resize', syncTopbarCompact))
function closeMoreMenu(e: MouseEvent) {
  if (!moreMenuOpen.value) return
  const t = e.target as HTMLElement | null
  if (t && !t.closest('.topbar-actions') && !t.closest('.topbar-more-btn')) moreMenuOpen.value = false
}
onMounted(() => document.addEventListener('click', closeMoreMenu))
onBeforeUnmount(() => document.removeEventListener('click', closeMoreMenu))
const source = ref('')
const isVideo = computed(() => videoSources.includes(source.value))
const originalSubtitles = ref<Array<{ text: string; start: number; end: number }> | null>(null)
const videoMeta = ref<{ url: string; type: string; duration: number } | null>(null)
const miniPlayerVisible = ref(false)
const miniPlayerStart = ref(0)
const miniPlayerEnd = ref<number | undefined>(undefined)
const miniPlayerRef = ref<any>(null)
const miniPlayerPlaying = computed(() => miniPlayerRef.value?.playing ?? false)
const forceReplayKey = ref(0)

function playSegment(para: any) {
  if (!videoMeta.value) return
  miniPlayerEnd.value = para.end
  // 同一段落再次点击：从头重新播放（不再跳转到视频播放页）
  miniPlayerStart.value = para.start
  miniPlayerVisible.value = true
  // 每次点击都强制 MiniPlayer 从 start 处重新播放
  forceReplayKey.value++
}
const { displayText: displayedContent, isTyping, startStreaming, appendText, endStream, finishStreaming, stopStreaming, showAll } = textStream
const { displayText: tcc, isTyping: chatTyping, startStreaming: startChatStream, appendText: appendChatText, endStream: endChatStream, stopStreaming: stopChatStream } = chatTextStream
const typingChatContent = computed(() => tcc.value)

const activeTab = ref('understand')

// ── 解释面板状态 ──
const explainSourceContent = ref('')       // 兜底显示的 Markdown（explainParsed 为空时用）
const activeExplainPid = ref('')          // 当前正在解释的段落 ID

// ── 理解区 Markdown 编辑器（编辑/显示切换）──
const explainViewTab = ref<'edit' | 'view'>('edit')   // edit=编辑(源码可改), view=显示(渲染预览)
const explainManuallyEdited = ref(false)               // 用户手动编辑过（禁用结构化渲染）

/** 保存当前段落的解释内容（手动输入 或 AI 生成后编辑） */
function saveExplanationContent() {
  const pid = activeExplainPid.value
  if (!pid) return
  const content = explainSourceContent.value
  const orig = article.getCachedExplanation(pid, 'explain') || ''
  // 内容为空且原本无缓存：跳过写入，避免在数据库里留下空键（空解释记录）
  if (!content.trim() && !orig) return
  // 未手动编辑的结构化内容：原缓存是 JSON 则保留（含逐句翻译），避免 markdown 覆盖破坏结构化；
  // 原缓存是旧版 markdown 则保存当前干净渲染（自我修复历史重复表头）
  let toSave = content
  if (!explainManuallyEdited.value && explainParsed.value) {
    try { JSON.parse(orig); toSave = orig } catch { toSave = content }
  }
  article.setCachedExplanation(pid, 'explain', toSave)
  article.setRightContent(content, 'explain')
  $fetch('/api/text/update', { method: 'POST', body: { id, explanations: { [`${pid}:explain`]: toSave } } }).catch(() => {})
}

/** 切换标记/显示：切到显示时保存 */
function switchExplainView(tab: 'edit' | 'view') {
  if (tab === 'view' && explainViewTab.value === 'edit') saveExplanationContent()
  explainViewTab.value = tab
}

const explainEditorEl = ref<HTMLTextAreaElement | null>(null)

/**
 * 段落解释编辑器：直接粘贴图片 → 上传并转成 Markdown 图片语法插入光标处。
 * 阻止冒泡，避免全局 onDocumentPaste 把图片追加到段落正文。
 */
async function onExplainEditorPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (!item.type.startsWith('image/')) continue
    e.preventDefault()
    e.stopPropagation()
    const file = item.getAsFile()
    if (!file) return
    try {
      const form = new FormData()
      const compressed = await compressImageFile(file)
      form.append('file', compressed, (compressed as File).name || 'paste.webp')
      form.append('id', id)
      const result = await $fetch<{ url: string }>('/api/upload/image', { method: 'POST', body: form })
      const el = explainEditorEl.value
      if (el) {
        const start = el.selectionStart ?? el.value.length
        const end = el.selectionEnd ?? start
        const md = `\n\n![图片](${result.url})\n\n`
        explainSourceContent.value = el.value.slice(0, start) + md + el.value.slice(end)
        explainManuallyEdited.value = true
        await nextTick()
        el.focus()
        el.setSelectionRange(start + md.length, start + md.length)
      }
    } catch (err: any) {
      alert('图片上传失败: ' + (err?.message || ''))
    }
    return
  }
}

/** 显示模式点击图片选宽度 → 改写 Markdown 里的尺寸标记并保存 */
function onExplainImageResize({ src, width }: { src: string; width: string }) {
  explainSourceContent.value = setMarkdownImageWidth(explainSourceContent.value, src, width)
  explainManuallyEdited.value = true
  saveExplanationContent()
}

const chatInput = ref('')
const chatLoading = ref(false)
const savedMessages = reactive(new Set<number>())
const quickQuestions = [
  { label: '解释段落', prompt: '请用中文详细解释当前段落的内容和含义。' },
  { label: '总结要点', prompt: '请用中文简要总结当前段落的核心要点。' },
  { label: '分析语法', prompt: '分析当前段落中出现的重点语法结构和表达方式。' },
  { label: '翻译全文', prompt: '请把当前段落翻译成流畅的中文。' },
]
const progressMsg = ref('')
const pdfUrl = ref(''); const showPdf = ref(false); const pdfPage = ref<number | null>(null)
const pdfViewerUrl = computed(() => {
  if (!pdfUrl.value) return ''
  if (pdfPage.value) return `${pdfUrl.value}#page=${pdfPage.value}`
  return pdfUrl.value
})
const marks = ref<Mark[]>([]); const readingPosition = ref<ReadingPosition | null>(null)
/** 未软删除的标记（软删除 = deletedAt 非空，进回收站） */
const activeMarks = computed(() => marks.value.filter(m => !m.deletedAt))
/** 回收站里的标记 */
const trashedMarks = computed(() => marks.value.filter(m => m.deletedAt))
/** 标记回收站弹窗 */
const trashVisible = ref(false)
function openTrash() { trashVisible.value = true }

/** 标记解释生成模式：默认自动，用户修改后持久化到本地 */
const markAutoGenerate = ref(true)
const MARK_AUTO_GENERATE_KEY = 'mark-auto-generate'
onMounted(() => {
  try {
    const saved = localStorage.getItem(MARK_AUTO_GENERATE_KEY)
    if (saved !== null) markAutoGenerate.value = saved !== 'false'
  } catch {}
})
function setMarkAutoGenerate(value: boolean) {
  markAutoGenerate.value = value
  try { localStorage.setItem(MARK_AUTO_GENERATE_KEY, String(value)) } catch {}
  if (value && markPopup.visible && !markPopup.mark.detail && !markPopup.loading && !markPopup.typing) {
    void handleGenerateMarkDetail()
  }
}

/** 章节目录（PDF 解析时提取的结构化字段） */
const chapters = ref<Chapter[]>([])
const tocVisible = ref(false)

/** 归一化标题：去掉页码标记与 Markdown # 前缀与空白，用于章节标题 ↔ 段落文本匹配 */
function normTitle(s: string): string {
  return s
    .replace(/^\[PAGE:\d+\]/i, '')   // 章节常位于页首，段落文本可能以 [PAGE:N] 开头
    .replace(/^[#\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** 章节 → 段落下标映射（用于目录跳转，随重新分段自动重算） */
const chapterAnchors = computed<number[]>(() => {
  const paras = article.paragraphs.value
  if (!paras.length) return chapters.value.map(() => -1)
  return chapters.value.map((ch) => {
    const target = normTitle(ch.title)
    // 优先：段落文本（去标题标记）以章节标题开头
    let idx = paras.findIndex((p) => {
      const t = normTitle(p.text)
      return t === target || t.startsWith(target + ' ')
    })
    if (idx >= 0) return idx
    // 兜底：段落内独立标题行（如 `# Chapter 1`）
    const esc = ch.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`^#{1,6}\\s*${esc}\\s*$`, 'im')
    idx = paras.findIndex((p) => re.test(p.text))
    return idx
  })
})

/** 点击目录项 → 跳转到对应段落 */
function jumpToChapter(chIndex: number) {
  const paraIdx = chapterAnchors.value[chIndex]
  tocVisible.value = false
  if (paraIdx < 0) return
  jumpToPara(paraIdx)
}
function markTypeLabel(t: string): string {
  return ({ word: '生词', phrase: '短语', sentence: '句子', note: '摘抄' } as any)[t] || t
}
function formatTrashTime(t?: string): string {
  if (!t) return ''
  const d = new Date(t)
  return `${d.toLocaleDateString('zh-CN')} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}
const paragraphNotes = ref<ParagraphNote[]>([])

// ── 每段落笔记（paragraphNotesMap: { [paragraphId]: RichEditor JSON }）──
const paraNotesMap = ref<Record<string, string>>({})

/** 兼容旧 markdown：非 JSON 的笔记转成纯文本富文本 JSON，避免丢失 */
function toRichJson(raw: string): string {
  if (!raw) return ''
  try { JSON.parse(raw); return raw } catch {
    const lines = raw.split(/\n+/).filter(Boolean)
    return JSON.stringify({
      type: 'doc',
      content: lines.map(line => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })),
    })
  }
}

/** 递归判断富文本 JSON 里是否有实际内容（文字 / 图片） */
function richHasContent(node: any): boolean {
  if (!node || typeof node !== 'object') return false
  if (node.type === 'text' && node.text?.trim()) return true
  if (node.type === 'image') return true
  if (Array.isArray(node.content)) return node.content.some(richHasContent)
  return false
}

/** 从富文本 JSON 提取纯文本预览 */
function richTextPreview(json: string): string {
  let doc: any = null
  try { doc = JSON.parse(json) } catch { return json.replace(/\s+/g, ' ').slice(0, 60) }
  const parts: string[] = []
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'text' && n.text) parts.push(n.text)
    if (n.type === 'image') parts.push('[图片]')
    if (Array.isArray(n.content)) n.content.forEach(walk)
  }
  walk(doc)
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 60)
}

/** 当前选中段落的笔记（跟随段落切换，RichEditor JSON） */
const currentParagraphNote = computed<string>({
  get: () => {
    const pid = activeParagraphId.value
    return pid ? toRichJson(paraNotesMap.value[pid] || '') : ''
  },
  set: (v) => {
    const pid = activeParagraphId.value
    if (!pid) return
    paraNotesMap.value = { ...paraNotesMap.value, [pid]: v }
    scheduleSaveParaNotes()
  },
})

/** 有笔记的段落列表（按段号排序，用于索引） */
const paraNoteList = computed(() =>
  Object.entries(paraNotesMap.value)
    .filter(([pid]) => hasParaNote(pid))
    .map(([pid, text]) => ({ pid, preview: richTextPreview(text) }))
    .sort((a, b) => paragraphIndex(a.pid) - paragraphIndex(b.pid))
)

function hasParaNote(pid: string): boolean {
  const raw = paraNotesMap.value[pid]
  if (!raw || !raw.trim()) return false
  try {
    return richHasContent(JSON.parse(raw))
  } catch {
    return !!raw.trim()
  }
}

let paraNoteTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSaveParaNotes() {
  if (paraNoteTimer) clearTimeout(paraNoteTimer)
  paraNoteTimer = setTimeout(saveParaNotes, 1000)
}
function saveParaNotes() {
  if (paraNoteTimer) { clearTimeout(paraNoteTimer); paraNoteTimer = null }
  $fetch('/api/text/update', { method: 'POST', body: { id, paragraphNotesMap: paraNotesMap.value } }).catch(() => {})
}

/** 跳转到某段并打开笔记面板 */
function jumpToNote(pid: string) {
  article.setActiveParagraph(pid)
  activeTab.value = 'notes'
  nextTick(() => {
    const el = document.querySelector(`[data-id="${pid}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    ;(el as HTMLElement)?.classList.add('note-flash')
    setTimeout(() => (el as HTMLElement)?.classList.remove('note-flash'), 2000)
  })
}

// ── Prompt 模板缓存（客户端从 API 加载一次） ──
const promptTemplates = reactive<Record<string, string>>({
  explain: '', markWord: '', markPhrase: '', markSentence: '',
})
async function loadPromptTemplates() {
  const names = ['explain', 'mark-word', 'mark-phrase', 'mark-sentence']
  for (const name of names) {
    try {
      const { content } = await $fetch<{ content: string }>(`/api/prompt/${name}`)
      const key = name === 'mark-word' ? 'markWord' : name === 'mark-phrase' ? 'markPhrase' : name === 'mark-sentence' ? 'markSentence' : name
      promptTemplates[key] = content
    } catch {}
  }
}
function fillPrompt(name: string, vars: Record<string, string>): { system: string; user: string } {
  const template = promptTemplates[name] || ''
  const parts = template.split('===USER===')
  const system = (parts[0]?.replace('===SYSTEM===', '').trim() || '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
  const user = (parts[1]?.trim() || '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
  return { system, user }
}
const readerBodyEl = ref<HTMLElement | null>(null)
const articlePane = ref<HTMLElement | null>(null)
const paraRefs = ref<HTMLElement[]>([])
// 分析面板开关（localStorage 持久，SSR 安全：服务端默认关闭，客户端 onMounted 后恢复）
const showAnalysisPanel = ref(false)
function loadPanelPref(): boolean {
  if (typeof window === 'undefined') return false
  if (window.innerWidth < 768) return false
  try { const v = localStorage.getItem('analysis-panel-visible'); if (v === null) return false; return v === 'true' } catch { return false }
}
onMounted(() => {
  showAnalysisPanel.value = loadPanelPref()
})
function toggleAnalysisPanel() {
  showAnalysisPanel.value = !showAnalysisPanel.value
  try { localStorage.setItem('analysis-panel-visible', String(showAnalysisPanel.value)) } catch {}
}
// 缩小到移动端宽度时自动处理面板状态
watch(isMobile, (mobile) => {
  if (mobile) {
    // 切换到窄屏：显示底部横条，折叠面板内容
    panelExpanded.value = false
  } else {
    // 切换回宽屏：恢复原有面板状态
    panelExpanded.value = false
  }
})

// ── 窄屏底部面板：展开/折叠 + 拖拽调整高度 ──
const panelExpanded = ref(false)
const panelHeight = ref(300) // 初始默认（onMounted 后更新为半屏）
const PANEL_MIN_HEIGHT = 120
const PANEL_MAX_HEIGHT = typeof window !== 'undefined' ? Math.floor(window.innerHeight * 0.85) : 600
const panelDragRef = ref<HTMLElement | null>(null)
let panelDragStartY = 0
let panelDragStartHeight = 0
let panelHasMoved = false // 区分拖拽和点击
let panelDragging = false

function onPanelResizeStart(e: MouseEvent | TouchEvent) {
  if (panelDragging) return // 防止 touch + mouse 重复触发
  // 如果触摸到交互元素（tab 按钮、chevron），不启动拖拽
  if ('touches' in e) {
    const target = (e as TouchEvent).target as HTMLElement
    if (target.closest('.panel-bottom-tab') || target.closest('.panel-bottom-chevron-wrap')) return
  }
  panelDragging = true
  panelDragStartY = 'touches' in e ? e.touches[0].clientY : e.clientY
  // 未展开时从 0 开始，拖拽边缘即面板顶部，实现 1:1 跟随鼠标
  panelDragStartHeight = panelExpanded.value ? panelHeight.value : 0
  panelHasMoved = false
  document.addEventListener('mousemove', onPanelResizeMove)
  document.addEventListener('mouseup', onPanelResizeEnd)
  document.addEventListener('touchmove', onPanelResizeMove, { passive: false })
  document.addEventListener('touchend', onPanelResizeEnd)
}

function onPanelResizeMove(e: MouseEvent | TouchEvent) {
  e.preventDefault()
  const clientY = 'touches' in e ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY
  const delta = panelDragStartY - clientY // 向上拖 = 增加高度
  if (Math.abs(delta) < 4 && !panelHasMoved) return // 防抖：小移动忽略
  panelHasMoved = true
  if (!panelExpanded.value) panelExpanded.value = true
  // 允许拖到最小值以下（方便完全收起），松手时再判断
  const newHeight = Math.min(PANEL_MAX_HEIGHT, panelDragStartHeight + delta)
  panelHeight.value = Math.max(0, newHeight)
}

function onPanelResizeEnd() {
  panelDragging = false
  document.removeEventListener('mousemove', onPanelResizeMove)
  document.removeEventListener('mouseup', onPanelResizeEnd)
  document.removeEventListener('touchmove', onPanelResizeMove)
  document.removeEventListener('touchend', onPanelResizeEnd)
  // 松手时：高度低于阈值则完全收起
  if (panelHeight.value < PANEL_MIN_HEIGHT) {
    panelExpanded.value = false
  }
}

function togglePanelExpand() {
  panelExpanded.value = !panelExpanded.value
  if (panelExpanded.value) {
    // 展开时使用半屏高度
    if (typeof window !== 'undefined') {
      panelHeight.value = Math.floor(window.innerHeight * 0.5)
    }
  }
}
// 记录哪些段落有问答历史（用于段落序号指示器）
const paragraphsWithChats = reactive(new Set<string>())

// QA 浮动区状态（按段落独立存储高度和拖拽标记）
const qaVisible = ref(false)
const answerHeightMap = ref<Record<string, number>>({})
const userAdjustedMap = ref<Record<string, boolean>>({})
const answerHeight = computed({
  get: () => answerHeightMap.value[activeParagraphId.value] ?? 120,
  set: (v) => { answerHeightMap.value[activeParagraphId.value] = v }
})
const userAdjustedHeight = computed({
  get: () => userAdjustedMap.value[activeParagraphId.value] ?? false,
  set: (v) => { userAdjustedMap.value[activeParagraphId.value] = v }
})
const QA_MIN_HEIGHT = 0
let qaResizing = false
const qaAnswerRef = ref<HTMLElement | null>(null)
const qaAreaRef = ref<HTMLElement | null>(null)
const chatInputEl = ref<HTMLInputElement | null>(null)
// 是否有回答内容（用于控制回答区是否显示）
const hasAnswerContent = computed(() =>
  currentParagraphChat.value.length > 0 || chatLoading.value || chatTyping.value
)
// QA 是否处于完全折叠态（无内容 + 高度归零）
// 回答区样式：折叠态透明，流式输出时自适应高度，手动拖拽后锁定高度
const isStreaming = computed(() => chatTyping.value || chatLoading.value)
const qaAnswerStyle = computed(() => {
  if (!hasAnswerContent.value || answerHeight.value === 0) {
    return { height: '0', padding: '0', overflow: 'hidden' }
  }
  // 流式输出中 → 自适应；用户未手动拖拽过 → 自适应
  if (isStreaming.value || !userAdjustedHeight.value) {
    return {}
  }
  return { height: answerHeight.value + 'px' }
})
// 流式输出期间自动滚到底部
watch(typingChatContent, () => {
  nextTick(() => {
    if (qaAnswerRef.value) qaAnswerRef.value.scrollTop = qaAnswerRef.value.scrollHeight
  })
})
// 折叠态自动隐藏定时器

// 笔记/生词本地数据
// 生词 — 从全文章 activeMarks 中自动提取 type=word 的标记（不含软删除）
const savedVocab = computed(() => {
  return activeMarks.value
    .filter(m => m.type === 'word')
    .map(m => {
      const phoneticMatch = m.detail?.match(/\[PHONETIC\]\/(.+?)\/\[\/PHONETIC\]/)
      const meaningMatch = m.detail?.match(/### 基本释义\n(.+)/)
      const lemmaMatch = m.detail?.match(/\[LEMMA\]\/(.+?)\/\[\/LEMMA\]/)
      return {
        text: m.text,
        lemma: m.lemma || lemmaMatch?.[1]?.trim() || '',
        phonetic: phoneticMatch?.[1] || '',
        meaning: meaningMatch?.[1]?.trim() || '',
      }
    })
})

const tabs = [
  { key: 'understand', label: '理解' },
  { key: 'notes', label: '笔记' },
  { key: 'vocab', label: '生词' },
]

const currentParaIdx = computed(() => {
  if (!activeParagraphId.value) return 0
  return paragraphs.value.findIndex(p => p.id === activeParagraphId.value)
})

/** 当前段落的生词标记数（驱动阅读赛道：读得越细跑得越快） */
const activeMarkedWordCount = computed(() => {
  const pid = activeParagraphId.value
  if (!pid) return 0
  return activeMarks.value.filter(m => m.paraId === pid && m.type === 'word').length
})

/** 超过 80 段时用滑动窗口显示 dots，避免溢出顶栏 */
const MAX_VISIBLE_DOTS = 80
const visibleDots = computed(() => {
  const total = paragraphs.value.length
  if (total <= MAX_VISIBLE_DOTS) {
    return Array.from({ length: total }, (_, i) => ({ type: 'dot' as const, index: i, key: `d${i}` }))
  }
  const cur = currentParaIdx.value
  const edge = 20      // 首尾各保留
  const midHalf = 15   // 当前附近各保留
  const start = Math.max(0, cur - midHalf)
  const end = Math.min(total, cur + midHalf + 1)
  const items: Array<{ type: 'dot' | 'gap'; index: number; key: string }> = []

  // 首部
  for (let i = 0; i < edge && i < start; i++) {
    items.push({ type: 'dot', index: i, key: `s${i}` })
  }
  // 间隙
  if (start > edge + 2) items.push({ type: 'gap', index: -1, key: 'g1' })
  else if (start > edge) {
    for (let i = edge; i < start; i++) items.push({ type: 'dot', index: i, key: `a${i}` })
  }
  // 中部
  for (let i = start; i < end; i++) {
    items.push({ type: 'dot', index: i, key: `m${i}` })
  }
  // 尾部间隙
  if (end < total - edge - 2) items.push({ type: 'gap', index: -1, key: 'g2' })
  else if (end < total - edge) {
    for (let i = end; i < total - edge; i++) items.push({ type: 'dot', index: i, key: `b${i}` })
  }
  // 尾部
  for (let i = Math.max(end, total - edge); i < total; i++) {
    items.push({ type: 'dot', index: i, key: `e${i}` })
  }
  return items
})

const readingPosIdx = computed(() => {
  if (!readingPosition.value) return 0
  return paragraphs.value.findIndex(p => p.id === readingPosition.value!.paragraphId) + 1
})

// 浮动翻译卡片
const tc = reactive({ visible: false, text: '', loading: false, position: { x: 200, y: 200 } })

// MarkPopup
const markPopup = reactive<{ visible: boolean; mark: Mark; loading: boolean; typing: boolean; typingContent: string; position: { x: number; y: number } }>({
  visible: false, mark: { id: '', paragraphId: '', startOffset: 0, endOffset: 0, text: '', type: 'word', color: '', detail: '', note: '', createdAt: '' },
  loading: false, typing: false, typingContent: '', position: { x: 200, y: 200 }
})

// ---- 渲染标记文字 ----
function locateMark(m: Mark, paraText: string): { start: number; end: number } | null {
  const markText = m.text
  if (!markText) return null

  // 先验证存储的 offset
  if (paraText.slice(m.startOffset, m.endOffset) === markText) {
    return { start: m.startOffset, end: m.endOffset }
  }

  // offset 失效 → 搜索定位
  const idx = paraText.indexOf(markText)
  if (idx === -1) return null

  // 唯一匹配 → 更新存储的 offset
  if (idx === paraText.lastIndexOf(markText)) {
    m.startOffset = idx
    m.endOffset = idx + markText.length
    return { start: idx, end: idx + markText.length }
  }

  // 多处出现 → 取离原 offset 最近的
  let best = idx, bestDist = Math.abs(idx - m.startOffset)
  let pos = idx
  while ((pos = paraText.indexOf(markText, pos + 1)) !== -1) {
    const dist = Math.abs(pos - m.startOffset)
    if (dist < bestDist) { best = pos; bestDist = dist }
  }
  m.startOffset = best
  m.endOffset = best + markText.length
  return { start: best, end: best + markText.length }
}

function renderMarkedText(p: Paragraph): string {
  // 解析标记 → 定位 → 过滤失效/软删除标记
  const resolved: Array<{ mark: Mark; start: number; end: number }> = []
  for (const m of activeMarks.value) {
    if (m.paragraphId !== p.id) continue
    const r = locateMark(m, p.text)
    if (r) resolved.push({ mark: m, start: r.start, end: r.end })
  }

  // 无标记 → 纯 Markdown 渲染
  if (!resolved.length) {
    try { return marked.parse(p.text, { breaks: true, gfm: true }) as string }
    catch { return escapeHtml(p.text).replace(/\n/g, '<br>') }
  }

  // 检测是否有重叠标记
  resolved.sort((a, b) => a.start - b.start)
  const hasOverlap = resolved.some((r, i) => {
    if (i === 0) return false
    return r.start < resolved[i - 1].end
  })

  // ── 无重叠 → token 路径（支持 Markdown）──
  if (!hasOverlap) {
    const tokens: string[] = []
    let text = p.text
    const sorted = [...resolved].sort((a, b) => b.start - a.start)
    for (const r of sorted) {
      const idx = tokens.length
      const token = `⟨MRK${idx}⟩`
      const markHtml = `<mark class="hl-${r.mark.type}" data-mark-id="${r.mark.id}" style="background:${r.mark.color}22;border-bottom:2px solid ${r.mark.color};cursor:pointer;border-radius:2px;padding:1px 0">${escapeHtml(text.slice(r.start, r.end))}</mark>`
      tokens.push(markHtml)
      text = text.slice(0, r.start) + token + text.slice(r.end)
    }
    try {
      const mdHtml = marked.parse(text, { breaks: true, gfm: true }) as string
      let result = mdHtml
      for (let i = 0; i < tokens.length; i++) {
        result = result.replace(`⟨MRK${i}⟩`, tokens[i])
      }
      // 如果任何 token 没被替换，说明 marked 改动了 token 字符 → 回退纯 MD
      if (/⟨MRK\d+⟩/.test(result)) throw new Error('Token not replaced')
      return result
    } catch {
      try { return marked.parse(p.text, { breaks: true, gfm: true }) as string }
      catch { return escapeHtml(p.text) }
    }
  }

  // ── 有重叠 → 先 Markdown 全文渲染，再叠加标记 ──
  resolved.sort((a, b) => (b.end - b.start) - (a.end - a.start))

  try {
    // 第一步：Markdown 渲染全文
    const mdHtml = marked.parse(p.text, { breaks: true, gfm: true }) as string

    // 第二步：按分段构建输出，未标记段从 mdHtml 提取，标记段用 <mark> 嵌套
    const points = new Set<number>()
    points.add(0); points.add(p.text.length)
    for (const r of resolved) { points.add(r.start); points.add(r.end) }
    const pointArr = [...points].sort((a, b) => a - b)

    // 提取 mdHtml 的纯文本 + 字符位置映射
    const mdText = mdHtml.replace(/<[^>]+>/g, '')
    function findInMdHtml(target: string, startPos: number): string {
      // 在 mdHtml 中从 startPos（源文本偏移）开始查找 target
      // 返回 mdHtml 中对应的 HTML 片段
      const plainBefore = mdText.slice(0, startPos).length
      // 简化：直接用 target 在 mdHtml 中搜索
      const escaped = escapeHtml(target)
      // 尝试在 mdHtml 中找到完整的 escaped 文本
      // 跳过可能在 HTML 标签内的匹配
      let searchFrom = 0
      // 跳过 startPos 之前的纯文本长度对应的 HTML 位置
      let plainCount = 0
      for (let i = 0; i < mdHtml.length; i++) {
        if (plainCount >= startPos) { searchFrom = i; break }
        if (mdHtml[i] === '<') { while (i < mdHtml.length && mdHtml[i] !== '>') i++; continue }
        plainCount++
      }
      const idx = mdHtml.indexOf(escaped, searchFrom)
      if (idx !== -1 && mdHtml.indexOf(escaped, idx + 1) === -1) return mdHtml.slice(idx, idx + escaped.length)
      // 原文被 marked 转换（如 *斜体* → <em>）后搜不到 → 用行内 Markdown 渲染，保证斜体/加粗生效
      return renderInlineMD(target)
    }

    let html = ''
    for (let i = 0; i < pointArr.length - 1; i++) {
      const segStart = pointArr[i]
      const segEnd = pointArr[i + 1]
      const segText = p.text.slice(segStart, segEnd)
      if (!segText) continue

      const covering = resolved.filter(r => r.start <= segStart && r.end >= segEnd)
      if (!covering.length) {
        // 无标记段 → 从 mdHtml 提取对应的 HTML
        html += findInMdHtml(segText, segStart)
        continue
      }

      // 有标记段 → 嵌套 <mark>
      let segHtml = escapeHtml(segText)
      for (let j = covering.length - 1; j >= 0; j--) {
        const m = covering[j]
        const depth = covering.length - 1 - j
        const alpha = depth === 0 ? '22' : String(Math.max(6, 22 - depth * 8)).padStart(2, '0')
        segHtml = `<mark class="hl-${m.mark.type}${depth > 0 ? ' hl-top' : ''}" data-mark-id="${m.mark.id}" data-mark-depth="${depth}" style="background:${m.mark.color}${alpha};border-bottom:2px solid ${m.mark.color};cursor:pointer;border-radius:2px;padding:1px 0">${segHtml}</mark>`
      }
      html += segHtml
    }
    return html
  } catch {
    return escapeHtml(p.text)
  }
}

function hasMarkdownSyntax(s: string): boolean {
  return /^#{1,6}\s|[*_~`]|^\s*[-*+]\s|^\s*\d+\.\s|^\s*>|\[.+\]\(.+\)/m.test(s)
}

/** 对无标记文本段应用 Markdown 行内渲染 */
function renderInlineMD(text: string): string {
  try {
    return marked.parseInline(text, { breaks: true, gfm: true }) as string
  } catch {
    return escapeHtml(text)
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---- QA 区控制 ----
function showQa() {
  qaVisible.value = true
  userAdjustedHeight.value = false
  if (currentParagraphChat.value.length > 0) {
    answerHeight.value = Math.min(200, (qaAreaRef.value?.closest('.qa-panel')?.getBoundingClientRect().height || 400) - 56)
  } else {
    answerHeight.value = 0
  }
}

function startQaResize(e: MouseEvent) {
  if (qaResizing) return
  qaResizing = true
  userAdjustedHeight.value = true
  // 捕获当前实际高度作为拖拽起点（border-box 下高度含 padding，与 getBoundingClientRect 一致）
  if (qaAnswerRef.value) {
    answerHeight.value = qaAnswerRef.value.getBoundingClientRect().height
  }
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'

  let startY = e.clientY
  let startH = answerHeight.value

  const SNAP_THRESHOLD = 30
  const QA_SNAP_MIN = 80

  const onMove = (ev: MouseEvent) => {
    if (!qaResizing) return
    const dy = startY - ev.clientY // 往上拖为正
    const newH = startH + dy

    // 向下拖拽：接近折叠态时磁吸归零，重新锚定以便继续向上拖
    if (newH <= SNAP_THRESHOLD) {
      answerHeight.value = 0
      startH = 0
      startY = ev.clientY
      return
    }

    // 从折叠态向上拖拽：超过阈值后从最小高度起偏移计算，鼠标移动直接映射为高度变化
    const effectiveH = startH === 0
      ? QA_SNAP_MIN + (newH - SNAP_THRESHOLD)
      : newH

    const panel = (e.target as HTMLElement).closest('.qa-panel')
    if (panel) {
      const maxH = panel.getBoundingClientRect().height - 56
      answerHeight.value = effectiveH > maxH ? maxH : effectiveH
    } else {
      answerHeight.value = effectiveH
    }
  }

  const cleanup = () => {
    qaResizing = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  const onUp = () => { userAdjustedHeight.value = true; cleanup() }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// ---- 文本选择浮动工具条（选中文字后弹出：词/短/句/译） ----

// ---- 段落顶部工具条（.para-actions）显隐开关 ----
/** 默认关闭：段落工具条（编辑/插入/合并/删除等）需手动开启，悬停段落即现 */
const paraActionsEnabled = ref(false)
const PARA_ACTIONS_KEY = 'reader-para-actions-enabled'
onMounted(() => { try { paraActionsEnabled.value = localStorage.getItem(PARA_ACTIONS_KEY) === '1' } catch {} })
watch(paraActionsEnabled, (v) => { try { localStorage.setItem(PARA_ACTIONS_KEY, v ? '1' : '0') } catch {} })
function toggleParaActions() {
  paraActionsEnabled.value = !paraActionsEnabled.value
}

const selToolbar = reactive({ visible: false, x: 0, y: 0, text: '', paraId: '', startOffset: 0, endOffset: 0, hasSelection: false })
const selToolbarStyle = computed(() => {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1024
  const h = typeof window !== 'undefined' ? window.innerHeight : 768
  return {
    left: Math.max(150, Math.min(selToolbar.x, w - 170)) + 'px',
    // 出现在选中文字下方；贴近屏幕底部时上收
    top: Math.max(8, Math.min(selToolbar.y + 8, h - 60)) + 'px',
  }
})

function handleTextSelect(p: Paragraph) {
  setTimeout(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      selToolbar.visible = false; selToolbar.hasSelection = false
      return
    }
    const text = sel.toString().trim()
    if (text.length < 2 || text.length > 2000) { selToolbar.visible = false; selToolbar.hasSelection = false; return }
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    // 尝试从 DOM 获取粗略偏移作为搜索提示
    const paraEl = (sel.anchorNode?.parentElement)?.closest('.para-text') as HTMLElement | null
    let hintOffset = 0
    if (paraEl) {
      const walker = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT)
      let offset = 0; let node: Node | null
      while ((node = walker.nextNode())) {
        if (node === range.startContainer) { hintOffset = offset + range.startOffset; break }
        offset += (node.textContent || '').length
      }
    }
    selToolbar.visible = true
    selToolbar.hasSelection = true
    selToolbar.x = rect.left + rect.width / 2
    selToolbar.y = rect.bottom // 工具条出现在选中文字下方
    selToolbar.text = text
    selToolbar.paraId = p.id
    selToolbar.startOffset = hintOffset
    selToolbar.endOffset = hintOffset + text.length
  }, 10)
}

// ---- 移动端：selectionchange 驱动（触摸设备长按选中文字时弹出工具条） ----
// 桌面端保留 mouseup 方式（避免拖选时工具条闪烁）
const IS_TOUCH_DEVICE = typeof window !== 'undefined' &&
  !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches

let selChangeTimer: ReturnType<typeof setTimeout> | null = null
function onSelectionChange() {
  if (selChangeTimer) clearTimeout(selChangeTimer)
  selChangeTimer = setTimeout(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      // 选区已清空 → 隐藏工具条
      selToolbar.visible = false; selToolbar.hasSelection = false
      return
    }
    // 找到选区所在段落块（.para-block 有 data-id）
    const blockEl = (sel.anchorNode?.parentElement)?.closest('.para-block') as HTMLElement | null
    if (!blockEl) {
      selToolbar.visible = false; selToolbar.hasSelection = false
      return
    }
    const pid = blockEl.dataset.id
    const para = paragraphs.value.find((p) => p.id === pid)
    if (para) handleTextSelect(para)
  }, 150)
}
if (IS_TOUCH_DEVICE) {
  onMounted(() => document.addEventListener('selectionchange', onSelectionChange))
  onUnmounted(() => {
    document.removeEventListener('selectionchange', onSelectionChange)
    if (selChangeTimer) clearTimeout(selChangeTimer)
  })
}

// ── 选区 → 翻译高亮联动（桌面 + 触摸，始终启用）──
let hlTimer: ReturnType<typeof setTimeout> | null = null

function splitSentences(text: string): { start: number; end: number; text: string }[] {
  const sentences: { start: number; end: number; text: string }[] = []
  // 无 lookbehind 的安全正则：标点 + 后面的空格或行尾
  const regex = /([.!?。！？"」])(\s+|$)/g
  let last = 0
  let m: RegExpExecArray | null
  let guard = 0
  while ((m = regex.exec(text)) && guard++ < 10000) {
    const end = m.index + m[1].length // 包含标点
    const s = text.slice(last, end).trim()
    if (s) sentences.push({ start: last, end, text: s })
    last = end
  }
  const tail = text.slice(last).trim()
  if (tail) sentences.push({ start: text.lastIndexOf(tail), end: text.length, text: tail })
  return sentences
}

function findSentenceAt(sentences: { start: number; end: number }[], offset: number): number {
  for (let i = 0; i < sentences.length; i++) {
    if (offset >= sentences[i].start && offset < sentences[i].end) return i
  }
  return sentences.length - 1
}

function findSelectedSentenceRange(pid: string): { startIdx: number; endIdx: number } {
  const para = paragraphs.value.find((p) => p.id === pid)
  if (!para) return { startIdx: -1, endIdx: -1 }
  const sentences = splitSentences(para.text)
  if (!sentences.length) return { startIdx: -1, endIdx: -1 }
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return { startIdx: -1, endIdx: -1 }
  const range = sel.getRangeAt(0)
  const block = document.querySelector(`.para-block[data-id="${pid}"]`)
  const textEl = block?.querySelector('.para-text') as HTMLElement | null
  if (!textEl) return { startIdx: -1, endIdx: -1 }
  // 用 DOM 精确计算选区起止在段落文本中的偏移（不依赖文本 indexOf 匹配）
  const startOffset = calcCharOffset(textEl, range.startContainer, range.startOffset)
  const endOffset = calcCharOffset(textEl, range.endContainer, range.endOffset)
  let startIdx = -1
  let endIdx = -1
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]
    if (s.end <= startOffset) continue
    if (startIdx === -1) startIdx = i
    if (s.start < endOffset) endIdx = i
    else break
  }
  if (startIdx === -1) { startIdx = 0; endIdx = 0 }
  return { startIdx, endIdx }
}

// ── 选区 → 翻译高亮（mouseup 触发，支持一次选多句连续高亮）──
function resetTransHighlight() {
  transParaHtml.value = explainParsed.value?.translation || ''
}
function updateTransHighlight(range: { startIdx: number; endIdx: number }) {
  const json = explainParsed.value
  if (!json || !json.translation) return
  if (range.startIdx === -1) { resetTransHighlight(); return }
  const full = json.translation
  const cnSentences = splitCnSentences(full)
  if (!cnSentences.length) { resetTransHighlight(); return }

  // 单句：优先用逐句译文匹配（更精准）
  if (range.startIdx === range.endIdx) {
    const target = (json.sentenceTranslations || [])[range.startIdx]
    if (target) {
      const loc = fuzzyLocate(full, target)
      if (loc.start !== -1) {
        transParaHtml.value =
          escapeHtml(full.slice(0, loc.start)) +
          `<mark class="trans-hl">${escapeHtml(full.slice(loc.start, loc.end))}</mark>` +
          escapeHtml(full.slice(loc.end))
        return
      }
    }
  }
  // 多句（或单句无逐句匹配）：按序号映射中文句段，高亮连续范围
  const cStart = mapToCnIndex(range.startIdx, cnSentences)
  const cEnd = mapToCnIndex(range.endIdx, cnSentences)
  if (cStart === -1 || cEnd === -1) { resetTransHighlight(); return }
  const hlStart = cnSentences[cStart].start
  const hlEnd = cnSentences[cEnd].end
  if (hlEnd <= hlStart) { resetTransHighlight(); return }
  transParaHtml.value =
    escapeHtml(full.slice(0, hlStart)) +
    `<mark class="trans-hl">${escapeHtml(full.slice(hlStart, hlEnd))}</mark>` +
    escapeHtml(full.slice(hlEnd))
}

/** 英文句子序号 → 中文句子序号（数量一致同序号，否则按句数比例映射） */
function mapToCnIndex(enIdx: number, cnSentences: { start: number; end: number }[]): number {
  const para = paragraphs.value.find((p) => p.id === activeExplainPid.value)
  const enSentences = para ? splitSentences(para.text) : []
  if (!enSentences.length) return Math.min(cnSentences.length - 1, Math.max(0, enIdx))
  if (enSentences.length !== cnSentences.length) {
    return Math.min(cnSentences.length - 1, Math.max(0, Math.round((enIdx / enSentences.length) * cnSentences.length)))
  }
  return Math.min(cnSentences.length - 1, Math.max(0, enIdx))
}
function onMouseUpHighlight() {
  if (hlTimer) clearTimeout(hlTimer)
  hlTimer = setTimeout(() => {
    const sel = window.getSelection()
    const text = sel ? sel.toString().trim() : ''
    if (!sel || sel.isCollapsed || !text) { resetTransHighlight(); return }
    const blockEl = (sel.anchorNode?.parentElement)?.closest('.para-block') as HTMLElement | null
    const pid = blockEl?.dataset.id
    if (!pid) { resetTransHighlight(); return }
    // 选中了其他段落：若该段落有缓存解释，自动加载到右侧并高亮
    if (pid !== activeExplainPid.value) {
      const cached = article.getCachedExplanation(pid, 'explain')
      if (!cached) return // 无缓存解释，保持现状
      article.setActiveParagraph(pid)
      loadExplanationEditor(pid)
    }
    updateTransHighlight(findSelectedSentenceRange(pid))
  }, 50)
}
onMounted(() => document.addEventListener('mouseup', onMouseUpHighlight))
onUnmounted(() => {
  document.removeEventListener('mouseup', onMouseUpHighlight)
  if (hlTimer) clearTimeout(hlTimer)
})

// ── 整段翻译中的模糊定位（精确优先，相似句段兜底）──
/** 从流式累积的 JSON 中提取 translation 字段（用于渐进显示翻译正文） */
function extractTranslation(raw: string): string | null {
  const m = raw.match(/"translation"\s*:\s*"((?:\\.|[^"\\])*)"/)
  if (m) {
    try { return JSON.parse('"' + m[1] + '"') } catch { return m[1] }
  }
  return null
}

function splitCnSentences(text: string): { start: number; end: number; text: string }[] {
  const sentences: { start: number; end: number; text: string }[] = []
  const regex = /([。！？!?])/g
  let last = 0
  let m: RegExpExecArray | null
  let guard = 0
  while ((m = regex.exec(text)) && guard++ < 10000) {
    const end = m.index + 1
    const s = text.slice(last, end).trim()
    if (s) sentences.push({ start: last, end, text: s })
    last = end
  }
  const tail = text.slice(last).trim()
  if (tail) sentences.push({ start: text.lastIndexOf(tail), end: text.length, text: tail })
  return sentences
}
function textSimilarity(a: string, b: string): number {
  const setA = new Set(a)
  const setB = new Set(b)
  let inter = 0
  for (const ch of setA) if (setB.has(ch)) inter++
  const union = setA.size + setB.size - inter
  return union === 0 ? 0 : inter / union
}
function fuzzyLocate(fullText: string, target: string): { start: number; end: number } {
  const idx = fullText.indexOf(target)
  if (idx !== -1) return { start: idx, end: idx + target.length }
  // 整段按中文句切分，找与目标最相似的一句
  const sentences = splitCnSentences(fullText)
  let best = -1
  let bestScore = 0
  for (let i = 0; i < sentences.length; i++) {
    const score = textSimilarity(target, sentences[i].text)
    if (score > bestScore) { bestScore = score; best = i }
  }
  if (best !== -1 && bestScore > 0.2) return { start: sentences[best].start, end: sentences[best].end }
  return { start: -1, end: -1 }
}

function handleDoubleClick(para: Paragraph) {
  // 双击：选中单词 → 显示工具条 → 自动发音
  setTimeout(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return
    const word = sel.toString().trim()
    if (word.length < 2 || word.length > 50) return
    article.pronounceWord(word)
  }, 20)
}

/** 在段落原文中查找选中文字的偏移 */
function findOffsetInSource(paraText: string, selectedText: string, hintOffset: number): { start: number; end: number } {
  const idx = paraText.indexOf(selectedText)
  if (idx === -1) return { start: 0, end: 0 }
  // 唯一匹配
  if (idx === paraText.lastIndexOf(selectedText)) {
    return { start: idx, end: idx + selectedText.length }
  }
  // 多处匹配 → 取离 hintOffset 最近的
  let best = idx, bestDist = Math.abs(idx - hintOffset)
  let pos = idx
  while ((pos = paraText.indexOf(selectedText, pos + 1)) !== -1) {
    const dist = Math.abs(pos - hintOffset)
    if (dist < bestDist) { best = pos; bestDist = dist }
  }
  return { start: best, end: best + selectedText.length }
}

function createMark(type: MarkType) {
  const para = paragraphs.value.find(p => p.id === selToolbar.paraId)
  if (!para) return
  const { start, end } = findOffsetInSource(para.text, selToolbar.text, selToolbar.startOffset)
  if (start === end) return // 找不到
  handleCreateMark(selToolbar.paraId, selToolbar.text, type, start, end)
  selToolbar.visible = false; selToolbar.hasSelection = false
  window.getSelection()?.removeAllRanges()
}

// ---- 段落点击 ----
function handleParaClick(p: Paragraph, e: MouseEvent) {
  const target = e.target as HTMLElement
  // 点击 Markdown 渲染的图片 → 打开图片查看器
  if (target.tagName === 'IMG') {
    const src = (target as HTMLImageElement).src
    if (src) { viewImage(src); return }
  }
  if (target.tagName === 'MARK') {
    const mid = target.dataset.markId
    const mark = marks.value.find(m => m.id === mid)
    if (mark && mark.type !== 'note') { handleShowMark(mark); return }
  }
  const sel = window.getSelection()
  if (sel && !sel.isCollapsed) return
  // 仅选中段落，不触发 AI 解析（由「AI 翻译此段」按钮触发）
  article.setActiveParagraph(p.id)
  loadExplanationEditor(p.id)
}

/** 加载段落的解释内容到理解区编辑器（缓存优先，无缓存则空编辑区） */
function loadExplanationEditor(pid: string) {
  // 先保存上一个段落的编辑
  if (activeExplainPid.value && activeExplainPid.value !== pid) saveExplanationContent()
  activeExplainPid.value = pid
  const cached = article.getCachedExplanation(pid, 'explain')
  if (cached) {
    const cachedJson = parseExplainJson(cached)
    const cachedParsed = cachedJson || parseExplainMarkdown(cached)
    explainParsed.value = cachedParsed
    transParaHtml.value = cachedParsed?.translation || ''
    if (cachedJson) {
      // JSON = AI 生成：可安全重写为结构化展示
      explainSourceContent.value = renderExplainMarkdown(cachedJson)
      explainManuallyEdited.value = false
    } else {
      // Markdown = 手动输入 或 旧 AI 数据：原样展示，绝不重写（防止额外内容被删）
      explainSourceContent.value = cached
      explainManuallyEdited.value = true
    }
    explainViewTab.value = 'view'
  } else {
    // 无缓存 → 空编辑区，停在「标记」模式方便直接输入
    explainParsed.value = null
    transParaHtml.value = ''
    explainSourceContent.value = ''
    explainManuallyEdited.value = false
    explainViewTab.value = 'edit'
  }
  article.setRightContent(explainSourceContent.value, 'explain')
}

// 段落复制成功反馈（图标短暂切换为对勾）
const copiedParaId = ref('')
let copyTimer: ReturnType<typeof setTimeout> | null = null
function doCopy(text: string, pid?: string) {
  navigator.clipboard.writeText(text).catch(() => {})
  if (pid) {
    copiedParaId.value = pid
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copiedParaId.value = '' }, 1500)
  }
}

// 段落文本编辑
const editingParagraphId = ref<string | null>(null)
const editText = ref('')
let editTextareaEl: HTMLTextAreaElement | null = null
const editRows = ref(1)
const editPreview = ref(false)  // 编辑模式下的 Markdown 预览开关

/** 根据文本内容自动调整 textarea 高度，使其与原文段落视觉大小一致 */
function autoResizeEditTextarea() {
  const ta = editTextareaEl
  if (!ta) return
  // 先重置为 1 行，再根据 scrollHeight 计算实际需要的行数
  ta.style.height = 'auto'
  const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 27
  const paddingV = parseFloat(getComputedStyle(ta).paddingTop) + parseFloat(getComputedStyle(ta).paddingBottom)
  const targetHeight = ta.scrollHeight - paddingV
  const rows = Math.max(1, Math.ceil(targetHeight / lineHeight))
  editRows.value = rows
  ta.style.height = '' // 清除临时高度，让 rows 属性接管
}

function startEdit(pid: string) {
  const para = paragraphs.value.find(p => p.id === pid)
  if (!para) return
  editingParagraphId.value = pid
  editText.value = para.text
  editPreview.value = false
  // 下一帧等 DOM 渲染后根据内容自动调整高度
  nextTick(() => { autoResizeEditTextarea() })
}
function saveEdit(pid: string) {
  const newText = editText.value.trim()
  if (!newText) {
    deleteParagraph(pid)
    return
  }

  // 标记重新定位
  const deletedMarkTexts: string[] = []
  for (const m of marks.value) {
    if (m.paragraphId !== pid) continue
    const r = locateMark(m, newText)
    if (!r) {
      deletedMarkTexts.push(m.text || '')
      marks.value = marks.value.filter(x => x.id !== m.id)
    }
  }

  if (deletedMarkTexts.length) {
    saveMarks()
    progressError.value = true
    progressMsg.value = `已移除 ${deletedMarkTexts.length} 个标记（文本变更导致无法定位：${deletedMarkTexts.slice(0, 3).join('、')}${deletedMarkTexts.length > 3 ? '等' : ''}）`
    setTimeout(() => { if (progressMsg.value?.startsWith('已移除')) { progressMsg.value = ''; progressError.value = false } }, 5000)
  }

  article.updateParagraphText(pid, newText)
  $fetch('/api/text/update-segment', {
    method: 'POST',
    body: { textId: id, segmentId: pid, text: newText },
  }).catch(() => {})
  editingParagraphId.value = null
  editText.value = ''
  editPreview.value = false
}
/** 编辑模式下预览 Markdown 渲染效果 */
function renderEditPreview(): string {
  try {
    return marked.parse(editText.value || '', { breaks: true, gfm: true }) as string
  } catch {
    return escapeHtml(editText.value || '').replace(/\n/g, '<br>')
  }
}

function cancelEdit() {
  editingParagraphId.value = null
  editText.value = ''
  editTextareaEl = null
  editPreview.value = false
}

// ── 段落插入 ──
const insertingPosition = ref<{ position: 'before' | 'after'; paragraphId: string } | null>(null)
const insertText = ref('')
let insertTextareaEl: HTMLTextAreaElement | null = null
const insertRows = ref(2)

function autoResizeInsertTextarea() {
  const ta = insertTextareaEl
  if (!ta) return
  ta.style.height = 'auto'
  const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 27
  const paddingV = parseFloat(getComputedStyle(ta).paddingTop) + parseFloat(getComputedStyle(ta).paddingBottom)
  const targetHeight = ta.scrollHeight - paddingV
  insertRows.value = Math.max(2, Math.ceil(targetHeight / lineHeight))
  ta.style.height = ''
}

function startInsert(position: 'before' | 'after', paragraphId: string) {
  insertingPosition.value = { position, paragraphId }
  insertText.value = ''
  insertRows.value = 2
  nextTick(() => {
    insertTextareaEl?.focus()
  })
}

function cancelInsert() {
  insertingPosition.value = null
  insertText.value = ''
  insertTextareaEl = null
}

function confirmInsert() {
  const text = insertText.value.trim()
  if (!text) { cancelInsert(); return }

  const pos = insertingPosition.value
  if (!pos) return

  const refPara = paragraphs.value.find(p => p.id === pos.paragraphId)
  if (!refPara) { cancelInsert(); return }

  // 计算插入位置索引
  const refIdx = paragraphs.value.indexOf(refPara)
  const insertIdx = pos.position === 'before' ? refIdx : refIdx + 1

  // 生成新段落 ID
  const newId = `seg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const newPara: Paragraph = { id: newId, index: insertIdx, text }

  // 插入新段落并重排后续索引
  const newParagraphs = [...paragraphs.value]
  newParagraphs.splice(insertIdx, 0, newPara)
  for (let i = insertIdx + 1; i < newParagraphs.length; i++) {
    newParagraphs[i] = { ...newParagraphs[i], index: i }
  }

  // 更新本地状态
  article.setParagraphs(newParagraphs)

  // 持久化到数据库
  $fetch('/api/text/insert-segment', {
    method: 'POST',
    body: { textId: id, beforeParagraphId: pos.position === 'before' ? pos.paragraphId : undefined, afterParagraphId: pos.position === 'after' ? pos.paragraphId : undefined, segmentId: newId, text },
  }).catch(() => {})

  cancelInsert()
}

// ── 段落删除 ──
async function deleteParagraph(pid: string) {
  const idx = paragraphs.value.findIndex(p => p.id === pid)
  if (idx === -1) { editingParagraphId.value = null; editText.value = ''; return }

  const para = paragraphs.value[idx]
  const markCount = activeMarks.value.filter(m => m.paragraphId === pid).length
  const imageCount = para.images?.length || 0

  // 确认提示
  const parts: string[] = [`确定删除「段落 ${idx + 1}」？`]
  if (markCount > 0) parts.push(`${markCount} 个标记将同时移除`)
  if (imageCount > 0) parts.push(`${imageCount} 张图片将同时移除`)
  if (!confirm(parts.join('，') + '。')) { editingParagraphId.value = null; editText.value = ''; editTextareaEl = null; return }

  // 清理此段落的标记
  let marksChanged = false
  const removed = marks.value.filter(m => m.paragraphId !== pid)
  if (removed.length !== marks.value.length) {
    marks.value = removed
    marksChanged = true
  }
  if (marksChanged) saveMarks()

  // 清理此段落的 AI 缓存
  article.setCachedExplanation(pid, 'explain', '')
  article.setCachedExplanation(pid, 'translate', '')

  // 清理此段落的笔记
  if (paraNotesMap.value[pid]) {
    const next = { ...paraNotesMap.value }
    delete next[pid]
    paraNotesMap.value = next
    scheduleSaveParaNotes()
  }

  // 清理阅读位置
  if (readingPosition.value?.paragraphId === pid) {
    readingPosition.value = null
    $fetch('/api/text/update', { method: 'POST', body: { id, readingPosition: null } }).catch(() => {})
  }

  // 从数组中移除并重排索引
  const newParagraphs = [...paragraphs.value]
  newParagraphs.splice(idx, 1)
  for (let i = 0; i < newParagraphs.length; i++) {
    newParagraphs[i] = { ...newParagraphs[i], index: i }
  }
  article.setParagraphs(newParagraphs)

  // 清除编辑状态
  editingParagraphId.value = null
  editText.value = ''
  editTextareaEl = null

  // 如果当前活跃段落被删，清除激活状态
  if (activeParagraphId.value === pid) {
    article.setActiveParagraph(null)
  }

  // 持久化
  try {
    await $fetch('/api/text/delete-segment', {
      method: 'POST',
      body: { textId: id, segmentId: pid },
    })
    progressMsg.value = `段落 ${idx + 1} 已删除`
    setTimeout(() => { if (progressMsg.value?.startsWith('段落')) progressMsg.value = '' }, 2000)
  } catch {
    progressError.value = true
    progressMsg.value = '删除失败，请刷新后重试'
    setTimeout(() => { progressMsg.value = ''; progressError.value = false }, 3000)
  }
}

// ── 段落合并 ──
async function mergeWithBelow(upperId: string) {
  const upperIdx = paragraphs.value.findIndex(p => p.id === upperId)
  if (upperIdx === -1 || upperIdx >= paragraphs.value.length - 1) return

  const upper = paragraphs.value[upperIdx]
  const lower = paragraphs.value[upperIdx + 1]

  // 合并文本
  const upperTextLen = upper.text.length
  const separator = '\n'
  const mergedText = upper.text + separator + lower.text

  // 迁移 lower 的标记到 upper
  let marksChanged = false
  for (const m of marks.value) {
    if (m.paragraphId === lower.id) {
      m.paragraphId = upper.id
      m.startOffset += upperTextLen + separator.length
      m.endOffset += upperTextLen + separator.length
      marksChanged = true
    }
  }
  if (marksChanged) saveMarks()

  // 合并图片
  const mergedImages = [...(upper.images || []), ...(lower.images || [])]

  // 合并对话历史
  const lowerChats = article.getParagraphChat(lower.id)
  if (lowerChats.length > 0) {
    const sepMsg: ChatMessage = { role: 'system', content: '── 以下对话来自合并前的下方段落 ──' }
    for (const msg of lowerChats) {
      article.addParagraphChatMessage(upper.id, msg)
    }
    // 把分隔消息插入到原始对话和 lower 对话之间
    const allChats = article.getParagraphChat(upper.id)
    const originalLen = allChats.length - lowerChats.length
    const reordered = [...allChats.slice(0, originalLen), sepMsg, ...allChats.slice(originalLen)]
    article.setParagraphChat(upper.id, reordered)
    article.loadParagraphChats({ [upper.id]: reordered })
  }

  // 更新本地段落数组
  const newParagraphs = [...paragraphs.value]
  newParagraphs[upperIdx] = { ...upper, text: mergedText, images: mergedImages.length ? mergedImages : undefined }
  newParagraphs.splice(upperIdx + 1, 1) // 删除 lower
  for (let i = 0; i < newParagraphs.length; i++) {
    newParagraphs[i] = { ...newParagraphs[i], index: i }
  }
  article.setParagraphs(newParagraphs)

  // 清除合并后段落的 AI 缓存
  article.setCachedExplanation(upper.id, 'explain', '')
  article.setCachedExplanation(upper.id, 'translate', '')

  // 持久化
  try {
    await $fetch('/api/text/merge-segments', {
      method: 'POST',
      body: { textId: id, upperParagraphId: upperId, lowerParagraphId: lower.id },
    })
    progressMsg.value = '段落已合并'
    setTimeout(() => { if (progressMsg.value === '段落已合并') progressMsg.value = '' }, 2000)
  } catch {
    progressError.value = true
    progressMsg.value = '合并失败，请刷新后重试'
    setTimeout(() => { progressMsg.value = ''; progressError.value = false }, 3000)
  }
}

function focusChatInput() {
  if (!qaVisible.value) qaVisible.value = true
  nextTick(() => { chatInputEl.value?.focus() })
}

// ---- 加载 ----
onMounted(() => {
})
onMounted(async () => {
  loadPromptTemplates()
  try {
    const data = await $fetch<any>(`/api/text/${id}`)
    if (!data?.text) throw new Error('No text')
    source.value = data.source || ''
    article.setTitle(data.title || titleFromSource(data.source || ''))
    article.setRawText(data.text)
    if (data.segments) {
      article.setParagraphs(data.segments)
    } else if (isVideo.value && data.videoSubtitles?.length) {
      // 视频：直接用字幕 cue 构建段落（每条字幕一段，自动补标点），避免无标点文本整篇合成一段
      const segs = segmentsFromCues(data.videoSubtitles, 1, true)
      article.setParagraphs(segs)
      $fetch('/api/text/update', { method: 'POST', body: { id, segments: segs } }).catch(() => {})
    } else {
      const segs = quickSegment(data.text)
      article.setParagraphs(segs)
      // 首次加载：将自然分段持久化到数据库，以便后续合并/拆分等操作能找到段落 ID
      $fetch('/api/text/update', { method: 'POST', body: { id, segments: segs } }).catch(() => {})
    }
    if (data.filePath) pdfUrl.value = `/api/file/${data.filePath}`
    if (data.analysis) { article.setAnalysis(data.analysis); showAll(formatMd(data.analysis)) }
    if (data.explanations) for (const [k, v] of Object.entries(data.explanations)) { const [pid, act] = k.split(':'); article.setCachedExplanation(pid, act as any, v as string) }
    if (data.marks) {
      marks.value = data.marks
      purgeExpiredTrash()
      // 从单词本「定位原文」进入：滚动到对应段落并打开标记弹窗
      const targetMark = String(route.query.mark || '')
      if (targetMark) setTimeout(() => focusMark(targetMark), 350)
    }
    if (data.paragraphNotes && data.paragraphNotes.length) {
      paragraphNotes.value = data.paragraphNotes
    }
    if (data.paragraphNotesMap) {
      paraNotesMap.value = data.paragraphNotesMap
    }
    if (data.chapters && Array.isArray(data.chapters)) {
      chapters.value = data.chapters
    }
    // 迁移旧格式：将 type='note' 的 marks 转为 paragraphNotes
    if (data.marks) {
      const noteMarks = data.marks.filter((m: any) => m.type === 'note')
      if (noteMarks.length) {
        const existingIds = new Set(paragraphNotes.value.map(n => n.id))
        for (const m of noteMarks) {
          if (existingIds.has(m.id)) continue
          paragraphNotes.value.push({
            id: m.id,
            paragraphId: m.paragraphId,
            startOffset: m.startOffset,
            endOffset: m.endOffset,
            quotedText: m.text,
            userContent: m.note || '',
            images: [],
            createdAt: m.createdAt || new Date().toISOString(),
            updatedAt: m.createdAt || new Date().toISOString(),
          })
        }
        // 从 marks 中移除已迁移的 note 标记，避免重复
        data.marks = data.marks.filter((m: any) => m.type !== 'note')
        // 保存清理后的 marks 和新 paragraphNotes
        $fetch('/api/text/update', { method: 'POST', body: { id, marks: data.marks, paragraphNotes: paragraphNotes.value } }).catch(() => {})
      }
    }
    if (data.readingPosition) {
      readingPosition.value = data.readingPosition
      // 等 DOM 渲染后计算小红旗位置
      nextTick(computeFlagPos)
    }
    if (data.paragraphChats) {
      article.loadParagraphChats(data.paragraphChats)
      for (const pid of Object.keys(data.paragraphChats)) paragraphsWithChats.add(pid)
    }
    if (data.videoSubtitles && Array.isArray(data.videoSubtitles)) {
      originalSubtitles.value = data.videoSubtitles
    }
    if (data.videoMeta) {
      videoMeta.value = data.videoMeta as { url: string; type: string; duration: number }
    }
    // 预取整篇用词的发音：服务端批量解析并落盘缓存，用户点词时零等待
    try { schedulePrefetchPronunciation(data.text || '') } catch {}
    // 分析改为手动触发（工具栏「AI 分析」按钮），不再打开文章自动消耗 API

    // 检查后台是否有分段正在执行（跨页面恢复 spinner）
    const segStatus = await $fetch<{ running: boolean }>(`/api/text/segment-status?id=${id}`).catch(() => ({ running: false }))
    if (segStatus.running) {
      segmenting.value = true
      pollSegments()
    }

    const markPid = route.query.mark as string
    if (markPid) { await nextTick(); const el = document.querySelector(`[data-id="${markPid}"]`); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
    $fetch('/api/text/stats', { method: 'POST', body: { id, marks: activeMarks.value.length } }).catch(() => {})
  } catch (e: any) { alert('加载失败'); navigateTo('/') }
})

/**
 * 预取整篇用词的发音地址。
 *
 * 为什么要预取：音库只收原形，变形词需要还原后再探测；旧实现每次点击都要现查，
 * 慢且不稳定。改成"打开文章时后台一次性把全文用词解析好（服务端并发 + 落盘缓存）"，
 * 用户点击时直接命中缓存，零等待。
 *
 * 放在 setTimeout 里是为了不阻塞首屏渲染（解析请求是网络 IO）。
 */
let prefetchTimer: ReturnType<typeof setTimeout> | null = null
function schedulePrefetchPronunciation(text: string) {
  if (!import.meta.client || !text) return
  if (prefetchTimer) clearTimeout(prefetchTimer)
  prefetchTimer = setTimeout(() => {
    prefetchTimer = null
    const words = pronTokenize(text)
    if (!words.length) return
    pronPrefetch(words)
  }, 600)
}

function goBack() {
  stopStreaming(); article.reset()
  const folder = route.query.folder as string
  navigateTo(folder ? `/?folder=${folder}` : '/')
}

function goToWatch() {
  const folder = route.query.folder as string
  const folderParam = folder ? `&folder=${encodeURIComponent(folder)}` : ''
  navigateTo(`/watch/${id}?from=read${currentTimeForWatch.value > 0 ? `&time=${currentTimeForWatch.value}` : ''}${folderParam}`)
}

function jumpToWatch(para: any) {
  const time = para?.start
  const folder = route.query.folder as string
  const folderParam = folder ? `&folder=${encodeURIComponent(folder)}` : ''
  if (time !== undefined) {
    navigateTo(`/watch/${id}?time=${time}${folderParam}`)
  } else {
    navigateTo(`/watch/${id}${folderParam ? `?folder=${encodeURIComponent(folder)}` : ''}`)
  }
}

const currentTimeForWatch = computed(() => {
  if (route.query.time) return parseFloat(route.query.time as string) || 0
  return 0
})

/** 从文件名/来源推导默认标题（去掉扩展名，兜底用） */
function titleFromSource(source: string): string {
  if (!source || source === 'paste' || source === 'upload') return '未命名'
  const base = source.split(/[\\/]/).pop() || source
  if (/^https?:/i.test(base)) return source.slice(0, 40)
  return base.replace(/\.[^.]+$/, '').trim() || '未命名'
}

function formatCueTime(seconds: number): string {
  if (seconds === undefined || seconds === null) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 保留原文段落结构：有自然段则逐段保留，没有则按句切分 */
function quickSegment(text: string, group = 10): Paragraph[] {
  const blocks = text.split(/\n\s*\n/).filter(b => b.trim())
  if (blocks.length > 1) {
    // 原文有自然段落 → 保留原样，不拆不合并
    return blocks.map((b, i) => ({ id: `q-${i}`, index: i, text: b.trim() }))
  }
  // 原文无段落结构 → 按句切分兜底
  return splitIntoParagraphs(text, group)
}

/** 按句子拆分并每 group 句合并为一段 */
function splitIntoParagraphs(text: string, group = 10): Paragraph[] {
  const GROUP = group
  const prepared = text.replace(/\.{3,}/g, '…')
  const sentences = prepared.split(/(?<=[.!?。！？"」])\s*/)
    .map(s => s.replace(/…/g, '...').trim())
    .filter(s => s.length > 0)
  if (sentences.length <= 1) {
    // 无标点（如字幕文本）：按行分组，避免整篇合成一段
    const lines = text.split(/\r?\n+/).map(l => l.trim()).filter(l => l.length > 0)
    if (lines.length > 1) {
      const result: Paragraph[] = []
      for (let i = 0; i < lines.length; i += GROUP) {
        const chunk = lines.slice(i, i + GROUP).join(' ').trim()
        if (chunk) result.push({ id: `q-${result.length}`, index: result.length, text: chunk })
      }
      if (result.length) return result
    }
    return [{ id: 'q-0', index: 0, text }]
  }

  const result: Paragraph[] = []
  for (let i = 0; i < sentences.length; i += GROUP) {
    const chunk = sentences.slice(i, i + GROUP).join(' ').trim()
    if (chunk) result.push({ id: `q-${result.length}`, index: result.length, text: chunk })
  }
  // 如果最后一组只剩 1-2 句，合并到前一段
  if (result.length > 1) {
    const lastGroupSize = sentences.length % GROUP
    if (lastGroupSize > 0 && lastGroupSize <= 2) {
      const last = result.pop()!
      result[result.length - 1].text += ' ' + last.text
    }
  }
  return result
}

function formatMd(a: any) { return [`## ${a.title}`, '', `**风格**：${a.tone}`, '', '### 内容摘要', a.summary, '', '### 背景分析', a.background, '', '### 关键要点', ...(a.keyPoints||[]).map((k: string) => `- ${k}`)].join('\n') }

/**
 * 将 AI 分段结果映射回原始字幕 cue，保留时间信息。
 * 对每个 AI 分段文本，在完整字幕拼接文本中定位 → 找到覆盖该位置的字幕 cue →
 * 取第一个 cue 的 start 作为段落时间戳。
 *
 * 匹配时做归一化（小写+去标点），让 AI 添加的标点和大小写不影响定位。
 */
function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[.,!?;:'"()\-\[\]{}<>/\\@#$%^&*~`]/g, '').replace(/\s+/g, ' ').trim()
}

function mapSegmentsToCues(
  segments: Paragraph[],
  cues: Array<{ text: string; start: number; end: number }>,
): Paragraph[] {
  if (!cues.length) return segments

  // 预计算每个 cue 的归一化词集（用于模糊匹配）
  const cueWords: Array<Set<string>> = cues.map(c => {
    const words = normalizeText(c.text).split(/\s+/).filter(w => w.length > 1)
    return new Set(words)
  })

  // 计算两段文本的词重叠数
  function wordOverlap(a: string, b: string): number {
    const wa = normalizeText(a).split(/\s+/).filter(w => w.length > 1)
    const wb = new Set(normalizeText(b).split(/\s+/).filter(w => w.length > 1))
    return wa.filter(w => wb.has(w)).length
  }

  return segments.map((seg, segIdx) => {
    const segClean = seg.text.replace(/\s+/g, ' ').trim()

    // 先尝试精确匹配（大部分情况下管用）
    let firstCueIdx = -1, lastCueIdx = -1

    // 用段落的开头词匹配第一个 cue
    const segWords = normalizeText(segClean).split(/\s+/)
    const segHead = segWords.slice(0, 5).join(' ')
    let bestScore = 0
    for (let i = 0; i < cues.length; i++) {
      const score = wordOverlap(segHead, cues[i].text)
      if (score > bestScore) { bestScore = score; firstCueIdx = i }
    }
    if (bestScore === 0) firstCueIdx = Math.floor(segIdx / Math.max(1, segments.length) * cues.length)

    // 用段落的结尾词匹配最后一个 cue
    const segTail = segWords.slice(-5).join(' ')
    bestScore = 0
    for (let i = firstCueIdx; i < cues.length; i++) {
      const score = wordOverlap(segTail, cues[i].text)
      if (score > bestScore) { bestScore = score; lastCueIdx = i }
    }
    if (bestScore === 0) {
      // 估算：下一个段落的起始 cue 之前，或当前段落按比例覆盖
      if (segIdx < segments.length - 1) {
        const nextSegHead = normalizeText(segments[segIdx + 1].text.replace(/\s+/g, ' ').trim()).split(/\s+/).slice(0, 5).join(' ')
        bestScore = 0
        for (let i = firstCueIdx; i < cues.length; i++) {
          const score = wordOverlap(nextSegHead, cues[i].text)
          if (score > bestScore) { bestScore = score; lastCueIdx = i - 1 }
        }
      }
      if (lastCueIdx < firstCueIdx) {
        const span = Math.max(1, Math.ceil(cues.length / segments.length))
        lastCueIdx = Math.min(firstCueIdx + span, cues.length - 1)
      }
    }

    return {
      ...seg,
      start: cues[firstCueIdx]?.start,
      end: cues[lastCueIdx >= 0 ? lastCueIdx : firstCueIdx]?.end,
    }
  })
}

/**
 * AI 分析（独立功能）：仅生成文章摘要、背景、关键要点，不影响分段
 */
async function runAnalysis(text: string) {
  const maxInput = 15000
  const inputText = text.length > maxInput
    ? text.slice(0, maxInput) + `\n\n[全文共 ${text.length} 字符，此处仅提供前 ${maxInput} 字符用于分析]`
    : text

  const prompt = `你是一位专业的文章分析助手。请分析以下文章并输出：

### 标题
简洁标题（10字以内）

### 风格
学术/科普/叙事/议论 等

### 内容摘要
核心内容概括（100-200字）

### 背景分析
写作背景和上下文

### 关键要点
- 要点一
- 要点二
- 要点三（3-5个）

## 文章内容
${inputText}

请严格按上述格式输出，直接从 "### 标题" 开始。`

  const msgs = [
    { role: 'system' as const, content: '按格式输出，禁止开场白。直接从 ### 开始。' },
    { role: 'user' as const, content: prompt },
  ]
  let full = ''

  startStreaming('')
  try {
    await deepseek.streamExplain(msgs, (chunk: string) => { full += chunk; appendText(chunk) })
    endStream()

    const a = {
      title: (full.match(/### 标题\n(.+)/)?.[1] || '').trim(),
      tone: (full.match(/### 风格\n(.+)/)?.[1] || '').trim(),
      summary: (full.match(/### 内容摘要\n([\s\S]+?)(?=\n###|$)/)?.[1] || '').trim(),
      background: (full.match(/### 背景分析\n([\s\S]+?)(?=\n###|$)/)?.[1] || '').trim(),
      keyPoints: (full.match(/### 关键要点\n([\s\S]+?)(?=\n###|$)/)?.[1] || '')
        .split('\n').filter((s: string) => s.trim().startsWith('-')).map((s: string) => s.replace(/^-\s*/, '')),
    }
    article.setAnalysis(a)
    // 同步标题到数据库
    $fetch('/api/text/update', { method: 'POST', body: { id, title: a.title, analysis: a } }).catch(() => {})
  } catch (err: any) {
    stopStreaming()
    const reason = err?.message || '未知错误'
    console.error('AI 分析失败:', reason)
    progressMsg.value = `AI 分析失败（${reason}）`
    progressError.value = true
    throw err
  }
}

/**
 * AI 分段（独立功能）：仅重新划分段落，不影响文章分析
 */
async function runSegmentation(text: string) {
  try {
    const segType = isVideo.value ? 'subtitle' : 'document'
    const sizeOverride = segSizeMap[segSizeKey.value]
    let segs = await $fetch<Paragraph[]>('/api/deepseek/segment', {
      method: 'POST',
      body: sizeOverride
        ? { text, type: segType, size: sizeOverride }
        : { text, type: segType },
    })

    // 视频字幕：将 AI 分段映射回原始字幕时间轴
    if (isVideo.value && originalSubtitles.value?.length) {
      segs = mapSegmentsToCues(segs, originalSubtitles.value)
    }

    article.setParagraphs(segs)
    article.clearParagraphCaches()
    // 保存分段 + 清除旧解释和对话（分段变了，旧解释无效）
    $fetch('/api/text/update', { method: 'POST', body: { id, segments: segs, explanations: {}, paragraphChats: {} } }).catch(() => {})
  } catch (err: any) {
    // segment 端点内部已有 fallback，此处额外的兜底
    const fallbackSegs = splitIntoParagraphs(text)
    article.setParagraphs(fallbackSegs)
    article.clearParagraphCaches()
    $fetch('/api/text/update', { method: 'POST', body: { id, segments: fallbackSegs, explanations: {}, paragraphChats: {} } }).catch(() => {})
    const reason = err?.message || '未知错误'
    progressMsg.value = `分段失败（${reason}），已使用本地分段。`
    progressError.value = true
    throw err
  }
}

const analyzing = ref(false)
const segmenting = ref(false)
const showAppearance = ref(false)
const hoveredParaId = ref<string | null>(null)
let hoverHideTimer: ReturnType<typeof setTimeout> | null = null
function scheduleParaHide() {
  hoverHideTimer = setTimeout(() => { hoveredParaId.value = null }, 1000)
}
function cancelParaHide() {
  if (hoverHideTimer) { clearTimeout(hoverHideTimer); hoverHideTimer = null }
}

// ── 分段粒度控制 ──
const segSizeGroups = [
  {
    key: 'ai',
    label: 'AI 分段',
    options: [
      { key: 'auto', label: '自动', hint: '按内容类型' },
      { key: 'academic', label: '学术', hint: '4–5 句/段' },
      { key: 'writing', label: '写作', hint: '5–6 句/段' },
      { key: 'news', label: '新闻', hint: '6–8 句/段' },
      { key: 'video', label: '视频', hint: '8–10 句/段' },
      { key: 'podcast', label: 'Podcast', hint: '10–12 句/段' },
    ],
  },
  {
    key: 'simple',
    label: '简单分段',
    options: [
      { key: 'simple', label: '简单', hint: '空行/句号' },
      { key: 'subtitle', label: '按字幕', hint: '按字幕条数分组' },
      { key: 'manual', label: '手动', hint: '粘贴已分好段的内容' },
    ],
  },
]
const segSizeMap: Record<string, { minSentences: number; maxSentences: number } | null> = {
  auto: null,
  academic: { minSentences: 4, maxSentences: 5 },
  writing: { minSentences: 5, maxSentences: 6 },
  news: { minSentences: 6, maxSentences: 8 },
  video: { minSentences: 8, maxSentences: 10 },
  podcast: { minSentences: 10, maxSentences: 12 },
}
const segSizeKey = ref('auto')
const showSegSizeMenu = ref(false)
const segSizeWrapRef = ref<HTMLElement | null>(null)
// 简单分段：每段句数（可选）
const simpleSentencesOptions = [5, 8, 10, 15, 20]
const simpleSentences = ref(10)

function toggleSegSizeMenu() {
  showSegSizeMenu.value = !showSegSizeMenu.value
}
function selectSegSize(opt: { key: string; label: string }) {
  segSizeKey.value = opt.key
  showSegSizeMenu.value = false
  if (opt.key === 'manual') {
    openManualSegModal()
  } else if (opt.key === 'simple') {
    runSimpleSegment()
  } else if (opt.key === 'subtitle') {
    openSubtitleSeg()
  } else {
    runManualSegment()
  }
}

// ── 按字幕条数分段（不调用 AI）──
const subtitleSegVisible = ref(false)
const subtitleSegCount = ref(10)
const subtitlePunctuate = ref(true)  // 自动补标点

function openSubtitleSeg() {
  subtitleSegCount.value = 10
  subtitleSegVisible.value = true
}

function confirmSubtitleSeg() {
  const n = Math.max(1, Math.floor(subtitleSegCount.value) || 10)
  subtitleSegVisible.value = false
  runSubtitleSegment(n, subtitlePunctuate.value)
}

/** 给无标点的字幕文本补标点：首字母大写 + 句尾加句号（已有标点则保留） */
function punctuateCueText(s: string): string {
  const t = s.trim()
  if (!t) return ''
  let out = t.charAt(0).toUpperCase() + t.slice(1)
  if (!/[.!?。！？]$/.test(out)) out += '.'
  return out
}

/** 按每 group 条字幕合并为一段（保留时间戳）；punctuate=true 时自动为每条字幕补标点 */
function segmentsFromCues(cues: Array<{ text: string; start?: number; end?: number }>, group: number, punctuate = true): Paragraph[] {
  const segs: Paragraph[] = []
  for (let i = 0; i < cues.length; i += group) {
    const batch = cues.slice(i, i + group)
    const text = batch
      .map(c => punctuate ? punctuateCueText(c.text) : c.text.trim())
      .filter(Boolean)
      .join(' ')
      .trim()
    if (!text) continue
    segs.push({
      id: `s-${segs.length}`,
      index: segs.length,
      text,
      start: batch[0]?.start,
      end: batch[batch.length - 1]?.end,
    })
  }
  return segs
}

function runSubtitleSegment(count: number, punctuate = true) {
  const cues = originalSubtitles.value
  if (!cues?.length) { progressError.value = true; progressMsg.value = '没有可用字幕'; setTimeout(() => { progressMsg.value = ''; progressError.value = false }, 2500); return }
  const n = Math.max(1, count)
  const segs = segmentsFromCues(cues, n, punctuate)
  if (!segs.length) return
  article.setParagraphs(segs)
  article.clearParagraphCaches()
  $fetch('/api/text/update', { method: 'POST', body: { id, segments: segs } }).catch(() => {})
  progressMsg.value = `已按字幕每 ${n} 条分为 ${segs.length} 段${punctuate ? '（已补标点）' : ''}`
  progressError.value = false
  setTimeout(() => { if (progressMsg.value?.startsWith('已按字幕')) progressMsg.value = '' }, 2500)
}

/** 从原文重建段落：视频按每条字幕一段（保留时间戳、自动补标点），文本按规则分段 */
function rebuildSegmentsFromText(): Paragraph[] {
  if (isVideo.value && originalSubtitles.value?.length) {
    return segmentsFromCues(originalSubtitles.value, 1, true)
  }
  return quickSegment(article.rawText.value || '', simpleSentences.value)
}

/** 重新导入原始文字：从数据库拉取原文，按原文重新分段载入学习模式 */
async function reimportOriginalText() {
  if (segmenting.value || analyzing.value) return
  if (!confirm('重新导入原始文字？\n将丢弃当前分段，按原始文字重新分段载入（合并/拆分/编辑等操作会丢失）。')) return
  segmenting.value = true
  try {
    const data = await $fetch<any>(`/api/text/${id}`)
    if (!data?.text) throw new Error('No text')
    source.value = data.source || ''
    article.setTitle(data.title || titleFromSource(data.source || ''))
    article.setRawText(data.text)
    // 总是从原文重建段落（视频按字幕，文本按规则）
    const segs = rebuildSegmentsFromText()
    article.setParagraphs(segs)
    article.clearParagraphCaches()
    await $fetch('/api/text/update', { method: 'POST', body: { id, segments: segs } })
    progressMsg.value = `已重新导入原文，分为 ${segs.length} 段`
    progressError.value = false
    setTimeout(() => { if (progressMsg.value?.startsWith('已重新导入')) progressMsg.value = '' }, 2500)
  } catch {
    progressError.value = true
    progressMsg.value = '重新导入失败，请重试'
    setTimeout(() => { progressMsg.value = ''; progressError.value = false }, 3000)
  } finally {
    segmenting.value = false
  }
}

/** 简单规则分段：不调用 AI。视频按字幕每 N 条合并（自动补标点），文本按空行/句号 */
function runSimpleSegment() {
  if (segmenting.value || !article.rawText.value) return
  const segs = isVideo.value && originalSubtitles.value?.length
    ? segmentsFromCues(originalSubtitles.value, simpleSentences.value, true)
    : quickSegment(article.rawText.value, simpleSentences.value)
  article.setParagraphs(segs)
  article.clearParagraphCaches()
  $fetch('/api/text/update', { method: 'POST', body: { id, segments: segs } }).catch(() => {})
  progressMsg.value = `已按规则分为 ${segs.length} 段（每段约 ${simpleSentences.value} 句${isVideo.value ? '，已补标点' : ''}）`
  progressError.value = false
  setTimeout(() => { if (progressMsg.value?.startsWith('已按规则')) progressMsg.value = '' }, 2500)
}

// ── 手动分段 / 播客整理上传（不调用 AI）──
const manualSegVisible = ref(false)
const manualSegText = ref('')
const manualNotesText = ref('')
const manualSegSaving = ref(false)
const manualSegError = ref('')
const manualSegCount = computed(() => {
  if (!manualSegText.value.trim()) return 0
  return manualSegText.value.split(/\n\s*\n/).map(s => s.trim()).filter(s => s.length > 0).length
})

function openManualSegModal() {
  manualSegText.value = article.rawText.value || ''
  manualNotesText.value = ''
  manualSegError.value = ''
  manualSegVisible.value = true
}

async function saveManualSegments() {
  const blocks = manualSegText.value.split(/\n\s*\n/).map(s => s.trim()).filter(s => s.length > 0)
  if (!blocks.length) { manualSegError.value = '没有检测到段落内容（用空行分隔段落）'; return }
  manualSegSaving.value = true
  manualSegError.value = ''
  try {
    await $fetch('/api/text/segments', {
      method: 'POST',
      body: {
        id,
        segments: blocks,
        notes: manualNotesText.value.trim() || undefined,
      },
    })
    manualSegVisible.value = false
    // 重新加载文章（段数变化 + 解释缓存已清空）
    const fresh = await $fetch<any>(`/api/text/${id}`)
    article.setRawText(fresh.text || article.rawText.value)
    article.setParagraphs(fresh.segments || [])
    article.clearParagraphCaches()
    // 重置理解区编辑器状态
    explainParsed.value = null
    transParaHtml.value = ''
    explainSourceContent.value = ''
    explainManuallyEdited.value = false
    activeExplainPid.value = ''
    article.setActiveParagraph(null)
    article.setRightContent('', 'explain')
  } catch (e: any) {
    manualSegError.value = e?.message || '保存失败'
  } finally {
    manualSegSaving.value = false
  }
}
function closeSegMenu(e: MouseEvent) {
  if (segSizeWrapRef.value && !segSizeWrapRef.value.contains(e.target as Node)) {
    showSegSizeMenu.value = false
  }
}
onMounted(() => document.addEventListener('click', closeSegMenu))
onUnmounted(() => document.removeEventListener('click', closeSegMenu))

// ── 书内搜索 ──
const searchVisible = ref(false)
const searchText = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const searchMatches = ref<Array<{ paraId: string; paraIdx: number; text: string }>>([])
const currentMatchIdx = ref(0)

function toggleSearch() {
  searchVisible.value = !searchVisible.value
  if (searchVisible.value) {
    nextTick(() => searchInputRef.value?.focus())
  } else {
    searchText.value = ''
    searchMatches.value = []
    currentMatchIdx.value = 0
    clearHighlights()
  }
}

function doSearch() {
  const q = searchText.value.trim().toLowerCase()
  searchMatches.value = []
  currentMatchIdx.value = 0
  clearHighlights()
  if (!q || q.length < 2) return

  const results: typeof searchMatches.value = []
  for (let i = 0; i < paragraphs.value.length; i++) {
    const p = paragraphs.value[i]
    if (p.text.toLowerCase().includes(q)) {
      results.push({ paraId: p.id, paraIdx: i, text: p.text })
    }
  }
  searchMatches.value = results
  if (results.length > 0) {
    currentMatchIdx.value = 0
    scrollToMatch(0)
  }
}

function nextMatch() {
  if (!searchMatches.value.length) return
  currentMatchIdx.value = (currentMatchIdx.value + 1) % searchMatches.value.length
  scrollToMatch(currentMatchIdx.value)
}

function prevMatch() {
  if (!searchMatches.value.length) return
  currentMatchIdx.value = (currentMatchIdx.value - 1 + searchMatches.value.length) % searchMatches.value.length
  scrollToMatch(currentMatchIdx.value)
}

function scrollToMatch(idx: number) {
  const m = searchMatches.value[idx]
  if (!m) return
  const el = document.querySelector(`[data-id="${m.paraId}"]`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    highlightMatch(m.paraId)
  }
}

function highlightMatch(paraId: string) {
  clearHighlights()
  const el = document.querySelector(`[data-id="${paraId}"]`)
  if (el) el.classList.add('search-highlight')
}

function clearHighlights() {
  document.querySelectorAll('.search-highlight').forEach(el => el.classList.remove('search-highlight'))
}

// Ctrl+F 快捷键
function onKeyDown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault()
    searchVisible.value = true
    nextTick(() => searchInputRef.value?.focus())
  }
  if (e.key === 'Escape' && searchVisible.value) {
    searchVisible.value = false
    searchText.value = ''
    searchMatches.value = []
    clearHighlights()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  // 立即落盘未保存的段落笔记
  if (paraNoteTimer) saveParaNotes()
})

const progressError = ref(false)

function dismissProgress() {
  progressMsg.value = ''
  progressError.value = false
}

// AI 分析（仅分析，不分段）
async function runManualAnalysis() {
  if (analyzing.value || !article.rawText.value) return
  analyzing.value = true
  article.isProcessingWritable.value = true
  progressMsg.value = 'AI 正在分析文章…'
  try {
    await runAnalysis(article.rawText.value)
    progressMsg.value = '分析完成'
  } catch { /* runAnalysis 内部已设置错误信息 */ }
  finally {
    analyzing.value = false; article.isProcessingWritable.value = false
    setTimeout(() => { if (!progressError.value) progressMsg.value = '' }, 3000)
  }
}

// 重新分段（后台运行，离开页面也不中断）
async function runManualSegment() {
  if (segmenting.value || analyzing.value || !article.rawText.value) return
  segmenting.value = true

  const mode = segSizeKey.value === 'podcast' ? 'podcast' : 'standard'
  const sizeOverride = segSizeMap[segSizeKey.value]

  try {
    await $fetch('/api/text/segment-async', {
      method: 'POST',
      body: {
        id: route.params.id,
        mode,
        size: sizeOverride || null,
      },
    })

    // 轮询等待分段完成
    pollSegments()
  } catch {
    segmenting.value = false
  }
}

let segmentPollTimer: ReturnType<typeof setInterval> | null = null

function pollSegments() {
  if (segmentPollTimer) clearInterval(segmentPollTimer)
  segmentPollTimer = setInterval(async () => {
    try {
      const data = await $fetch<any>(`/api/text/${route.params.id}`)
      const freshSegs = data?.segments
      const currentSegs = article.paragraphs.value

      // 段数变了 或 内容变了 → 分段已完成
      if (freshSegs?.length && freshSegs.length !== currentSegs.length) {
        article.setParagraphs(freshSegs)
        article.clearParagraphCaches()
        segmenting.value = false
        if (segmentPollTimer) { clearInterval(segmentPollTimer); segmentPollTimer = null }
      }
    } catch { /* 继续等待 */ }
  }, 3000)

  // 最多等 2 分钟
  setTimeout(() => {
    if (segmentPollTimer) {
      clearInterval(segmentPollTimer)
      segmentPollTimer = null
      segmenting.value = false
    }
  }, 120000)
}

onUnmounted(() => {
  if (segmentPollTimer) clearInterval(segmentPollTimer)
})

const pendingExplain = ref('')

/**
 * 从段落文本在原文中定位页码。
 * 原文每页起始处有 [PAGE:N] 标记，从段落位置往回搜索最近的标记。
 * 性能：单次 lastIndexOf，O(n) 但对百万字文本也是微秒级。
 */
function locateParagraphPage(para: Paragraph): number | null {
  const fullText = article.rawText.value
  if (!fullText) return null
  // 在原文中查找段落起始位置（用前 60 字符精确匹配）
  const pos = fullText.indexOf(para.text.replace(/\s+/g, ' ').trim().slice(0, 60))
  if (pos < 0) return null
  // 从该位置往回搜索最近的 [PAGE:N] 标记
  const prefix = fullText.slice(0, pos)
  const matches = [...prefix.matchAll(/\[PAGE:(\d+)\]/g)]
  if (matches.length === 0) return null
  return parseInt(matches[matches.length - 1][1], 10)
}

function openPdfAtParagraph(para: Paragraph) {
  const page = locateParagraphPage(para)
  if (page !== null) {
    pdfPage.value = page
  } else {
    pdfPage.value = null
  }
  showPdf.value = true
}

/** 整理段落：补标点、分句、排版 */
const cleaningPara = ref<string | null>(null)
async function cleanParagraph(pid: string, ptext: string) {
  if (cleaningPara.value) return
  cleaningPara.value = pid
  try {
    const { cleaned } = await $fetch<{ cleaned: string }>('/api/deepseek/clean', {
      method: 'POST',
      body: { text: ptext },
    })
    if (cleaned && cleaned !== ptext) {
      article.updateParagraphText(pid, cleaned)
      article.setCachedExplanation(pid, 'explain', '')
      article.setCachedExplanation(pid, 'translate', '')
      // 标记重新定位
      let marksChanged = false
      for (const m of marks.value) {
        if (m.paragraphId !== pid) continue
        const r = locateMark(m, cleaned)
        if (!r) {
          marks.value = marks.value.filter(x => x.id !== m.id)
          marksChanged = true
        }
      }
      if (marksChanged) saveMarks()
      // 持久化
      $fetch('/api/text/update-segment', {
        method: 'POST',
        body: { textId: id, segmentId: pid, text: cleaned },
      }).catch(() => {})
    }
  } catch (e: any) {
    // 静默失败
  } finally {
    cleaningPara.value = null
  }
}

/** 重新分析段落：清除缓存 → 强制重新请求 AI */
function reAnalyzeParagraph(pid: string, ptext: string) {
  article.setCachedExplanation(pid, 'explain', '')
  article.setCachedExplanation(pid, 'translate', '')
  handleParagraphAction('explain', pid, ptext)
}

// ── 段落图片：上传 + 粘贴 + 尺寸调节 ──
const paraImageSizes = ref<Record<string, 'sm' | 'md' | 'lg'>>({})

function paraImageSize(paraId: string): 'sm' | 'md' | 'lg' {
  return paraImageSizes.value[paraId] || 'md'
}
function setParaImageSize(paraId: string, size: 'sm' | 'md' | 'lg') {
  paraImageSizes.value = { ...paraImageSizes.value, [paraId]: size }
}

const collapsedImages = ref<Record<string, boolean>>({})
function isParaImagesCollapsed(paraId: string): boolean {
  return !!collapsedImages.value[paraId]
}
function toggleParaImages(paraId: string) {
  collapsedImages.value = { ...collapsedImages.value, [paraId]: !collapsedImages.value[paraId] }
}

async function refreshParagraphs() {
  try {
    const data = await $fetch<any>(`/api/text/${id}`)
    if (data?.segments?.length) article.setParagraphs(data.segments)
  } catch {}
}

const imageFileInput = ref<HTMLInputElement | null>(null)

function insertImageForParagraph(paraId: string) {
  const input = document.createElement('input')
  input.type = 'file'; input.accept = 'image/*'
  input.onchange = () => {
    const file = input.files?.[0]
    if (file) uploadParaImage(paraId, file)
  }
  input.click()
}

async function uploadParaImage(paraId: string, file: File | Blob, filename = 'image.png') {
  const para = paragraphs.value.find(p => p.id === paraId)
  if (!para) return
  try {
    const compressed = await compressImageFile(file)
    const form = new FormData()
    form.append('file', compressed, (compressed as File).name || filename)
    form.append('id', id)

    const result = await $fetch<{ url: string }>('/api/upload/image', { method: 'POST', body: form })
    // 将 Markdown 图片语法插入段落文本末尾（之后可编辑移动到任意位置）
    const imgMd = `\n\n![](${result.url})`
    const newText = para.text + imgMd
    article.updateParagraphText(paraId, newText)
    $fetch('/api/text/update-segment', { method: 'POST', body: { textId: id, segmentId: paraId, text: newText } }).catch(() => {})
    progressMsg.value = '图片已插入段落末尾，可编辑移动位置'
    setTimeout(() => { if (progressMsg.value?.startsWith('图片已插入')) progressMsg.value = '' }, 2500)
  } catch (e: any) {
    alert('图片上传失败: ' + (e?.message || ''))
  }
}

async function removeParaImage(paraId: string, imageName: string) {
  try {
    await $fetch('/api/paragraph/image', { method: 'DELETE', body: { id, paragraphId: paraId, imageName } })
    await refreshParagraphs()
  } catch (e: any) {
    alert('删除失败: ' + (e?.message || ''))
  }
}

const floatingImage = ref<{ src: string; title: string } | null>(null)

function viewImage(url: string) {
  floatingImage.value = { src: url, title: '图片预览' }
}

// ── 全局粘贴图片 ──
function onDocumentPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const blob = item.getAsFile()
      const targetId = activeParagraphId.value || 'p-0'
      if (blob) uploadParaImage(targetId, blob, 'paste.png')
      return
    }
  }
}

onMounted(() => { document.addEventListener('paste', onDocumentPaste) })
onUnmounted(() => { document.removeEventListener('paste', onDocumentPaste) })

/** 「AI 翻译此段」：对当前选中段落触发 AI 解析 */
function explainCurrentParagraph() {
  const pid = activeParagraphId.value
  if (!pid || pendingExplain.value === pid) return
  const para = paragraphs.value.find(p => p.id === pid)
  if (!para) return
  handleParagraphAction('explain', pid, para.text)
}

async function handleParagraphAction(action: ParagraphAction, pid: string, ptext: string) {
  article.setActiveParagraph(pid)
  const cached = article.getCachedExplanation(pid, action)
  if (cached) {
    if (action === 'explain') {
      // JSON = AI 生成（可重写）；Markdown = 手动输入/旧数据（原样展示，不重写防丢内容）
      const cachedJson = parseExplainJson(cached)
      const cachedParsed = cachedJson || parseExplainMarkdown(cached)
      explainParsed.value = cachedParsed
      transParaHtml.value = cachedParsed?.translation || ''
      if (cachedJson) {
        explainSourceContent.value = renderExplainMarkdown(cachedJson)
        explainManuallyEdited.value = false
      } else {
        explainSourceContent.value = cached
        explainManuallyEdited.value = true
      }
      explainViewTab.value = 'view'
      article.setRightContent(explainSourceContent.value, action); showAll(explainSourceContent.value)
      activeExplainPid.value = pid
    } else {
      article.setRightContent(cached, action); showAll(cached)
    }
    return
  }
  if (pendingExplain.value === pid) return
  pendingExplain.value = pid
  article.setRightContent('', action)

  let messages: Array<{ role: string; content: string }>
  if (action === 'explain') {
    // 使用 refine 后的 explain 模板（含完整表格格式规则）
    const vars = {
      paragraphText: ptext,
      articleContext: article.getArticleContext(),
    }
    const filled = fillPrompt('explain', vars)
    messages = [
      { role: 'system', content: filled.system },
      { role: 'user', content: filled.user },
    ]
  } else {
    // 翻译用简单 prompt
    messages = [
      { role: 'system', content: '你是专业翻译。忠实原文，只输出翻译结果，不要任何解释。' },
      { role: 'user', content: `将以下段落翻译成流畅自然的中文：\n\n${ptext}` },
    ]
  }
  // ── explain：重置显示状态 ──
  if (action === 'explain') {
    // 若当前段落已有手动编辑内容，先保存再重新生成（避免覆盖丢失）
    if (activeExplainPid.value === pid && explainSourceContent.value) saveExplanationContent()
    // 清空旧段落解释，显示加载中
    explainParsed.value = null
    transParaHtml.value = ''
    explainSourceContent.value = ''
    explainManuallyEdited.value = false
    activeExplainPid.value = pid
  }

  let fullResult = ''; startStreaming('')
  const isExplain = action === 'explain'
  try {
    await deepseek.streamExplain(messages, (chunk: string) => {
      fullResult += chunk
      if (isExplain) {
        // 流式渐进：优先显示翻译正文（不必等完整 JSON）
        const t = extractTranslation(fullResult)
        if (t) transParaHtml.value = escapeHtml(t)
      } else {
        appendText(chunk)
        explainSourceContent.value = fullResult
      }
    }, isExplain ? { response_format: { type: 'json_object' } } : undefined)
    endStream()

    if (isExplain) {
      // 解析模型输出的 JSON → 用固定模板渲染成 Markdown（格式 100% 由代码控制）
      const parsed = parseExplainJson(fullResult)
      const markdown = parsed ? renderExplainMarkdown(parsed) : ''
      // 解析失败（多为输出被截断）：显示友好提示，不展示原始 JSON
      const display = parsed ? markdown : '⚠️ 解释生成不完整，请点击段落重新生成。'
      explainParsed.value = parsed
      transParaHtml.value = parsed?.translation || ''
      explainSourceContent.value = display
      explainManuallyEdited.value = false
      explainViewTab.value = 'view'
      article.setCachedExplanation(pid, action, parsed ? fullResult : display)
      article.setRightContent(display, action)
      $fetch('/api/text/update', { method: 'POST', body: { id, explanations: { [`${pid}:${action}`]: parsed ? fullResult : display } } }).catch(() => {})
    } else {
      article.setCachedExplanation(pid, action, fullResult)
      article.setRightContent(fullResult, action)
      $fetch('/api/text/update', { method: 'POST', body: { id, explanations: { [`${pid}:${action}`]: fullResult } } }).catch(() => {})
    }
  } catch (e: any) { stopStreaming() }
  finally { pendingExplain.value = '' }
}

// ── 段落解释的解析结果 + 句子高亮联动 ──
const explainParsed = ref<ExplainJson | null>(null)
/** 整段翻译的 HTML（选中原文时高亮对应句段） */
const transParaHtml = ref('')
/** 缓存词汇表+精讲的 Markdown，避免高亮变化时重复解析 */
const explainBodyMarkdown = computed(() => explainParsed.value ? renderExplainBody(explainParsed.value) : '')
/** 整体翻译渲染：Markdown + 换行 + 高亮标记（trans-hl）一次处理 */
const transRenderedHtml = computed(() => {
  if (!transParaHtml.value) return ''
  try {
    return marked.parse(transParaHtml.value, { breaks: true, gfm: true, html: true }) as string
  } catch {
    return escapeHtml(transParaHtml.value).replace(/\n/g, '<br>')
  }
})

// ── 解释全文（后台批量生成，离开页面任务继续）──
const explainAll = reactive({ running: false, total: 0, done: 0, failed: 0 })
let explainAllTimer: ReturnType<typeof setInterval> | null = null

/** 后台「解释全文」完成后：重新拉取 explanations 刷新内存缓存，并重载当前段落显示 */
async function refreshExplanationsAfterExplainAll() {
  try {
    const data = await $fetch<any>(`/api/text/${id}`)
    if (data.explanations) {
      for (const [k, v] of Object.entries(data.explanations)) {
        const [pid, act] = k.split(':')
        article.setCachedExplanation(pid, act as any, v as string)
      }
    }
    const pid = activeExplainPid.value || activeParagraphId.value
    if (pid) loadExplanationEditor(pid)
  } catch {}
}

async function pollExplainAll() {
  try {
    const p = await $fetch<{ total: number; done: number; failed: number; running: boolean }>(
      `/api/text/${id}/explain-all-progress`,
    )
    explainAll.total = p.total
    explainAll.done = p.done
    explainAll.failed = p.failed
    if (!p.running) {
      explainAll.running = false
      if (explainAllTimer) { clearInterval(explainAllTimer); explainAllTimer = null }
      refreshExplanationsAfterExplainAll()
    }
  } catch {
    explainAll.running = false
    if (explainAllTimer) { clearInterval(explainAllTimer); explainAllTimer = null }
  }
}

async function startExplainAll() {
  if (explainAll.running) return
  try {
    const res = await $fetch<{ total: number; pending: number }>(`/api/text/${id}/explain-all`, { method: 'POST' })
    explainAll.running = true
    explainAll.total = res.total
    explainAll.done = res.total - res.pending
    if (explainAllTimer) clearInterval(explainAllTimer)
    explainAllTimer = setInterval(pollExplainAll, 2000)
    pollExplainAll()
  } catch {
    explainAll.running = false
  }
}

onUnmounted(() => {
  if (explainAllTimer) { clearInterval(explainAllTimer); explainAllTimer = null }
})

async function handleQuickTranslate(text: string, position: { x: number; y: number }) {
  tc.visible = true; tc.loading = true; tc.text = ''
  tc.position = { x: Math.min(position.x, window.innerWidth - 340), y: position.y + 10 }
  try {
    const result = await deepseek.paragraphAction(text, 'translate', article.getArticleContext())
    tc.text = result; tc.loading = false
  } catch { tc.visible = false }
}

// ── 历史摘抄笔记（仅保留旧数据展示与删除）──

async function persistParagraphNotes() {
  try {
    await $fetch('/api/text/paragraph-notes', {
      method: 'POST',
      body: { textId: id, paragraphNotes: JSON.parse(JSON.stringify(paragraphNotes.value)) },
    })
  } catch { /* ignore */ }
}

async function deleteNote(idx: number) {
  if (!confirm('确定删除这条摘抄？')) return
  const noteId = paragraphNotes.value[idx]?.id
  paragraphNotes.value.splice(idx, 1)
  // 同时移除对应的视觉标记
  if (noteId) {
    marks.value = marks.value.filter(m => m.id !== noteId)
    saveMarks()
  }
  await persistParagraphNotes()
}

/** 从单词本跳转过来：定位到标记所在段落，并打开该标记的解析弹窗 */
function focusMark(markId: string) {
  const m = marks.value.find(x => x.id === markId && !x.deletedAt)
  if (!m) return
  nextTick(() => {
    const block = document.querySelector(`.para-block[data-id="${m.paragraphId}"]`) as HTMLElement | null
    if (block) {
      block.scrollIntoView({ behavior: 'smooth', block: 'center' })
      block.classList.add('note-flash')
      setTimeout(() => block.classList.remove('note-flash'), 2400)
    }
    handleShowMark(m)
  })
}

function jumpToNoteSource(note: ParagraphNote) {  activeTab.value = 'analyze'
  nextTick(() => {
    const el = document.querySelector(`[data-id="${note.paragraphId}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      ;(el as HTMLElement).classList.add('note-flash')
      setTimeout(() => (el as HTMLElement).classList.remove('note-flash'), 2000)
    }
  })
}

function paragraphIndex(pid: string): number {
  return paragraphs.value.findIndex(p => p.id === pid) + 1
}

/** 取标记所在句子：从选区向两侧扩到句末标点，作为卡片的记忆线索 */
function sentenceAt(text: string, start: number, end: number): string {
  if (!text) return ''
  const isBoundary = (ch: string) => /[.!?。！？\n]/.test(ch)
  let s = Math.max(0, start)
  let e = Math.min(text.length, end)
  while (s > 0 && !isBoundary(text[s - 1])) s--
  while (e < text.length && !isBoundary(text[e])) e++
  if (e < text.length && /[.!?。！？]/.test(text[e])) e++
  return text.slice(s, e).replace(/\s+/g, ' ').trim().slice(0, 400)
}

async function handleCreateMark(pid: string, text: string, type: MarkType, startOffset: number, endOffset: number) {
  const dup = marks.value.find(m => m.paragraphId === pid && m.startOffset === startOffset && m.endOffset === endOffset)
  if (dup) return
  const paraText = paragraphs.value.find(p => p.id === pid)?.text || ''
  const m: Mark = { id: `m_${Date.now()}`, paragraphId: pid, startOffset, endOffset, text, type, color: MARK_COLORS[type], detail: '', note: '', context: sentenceAt(paraText, startOffset, endOffset), createdAt: new Date().toISOString() }
  marks.value.push(m)
  // 默认自动生成解释；用户切换为手动后，仍可点击「AI 生成」
  markPopup.mark = m; markPopup.visible = true; markPopup.loading = false; markPopup.typing = false; markPopup.typingContent = ''
  markPopup.position = { x: Math.min(window.innerWidth - 420, 400), y: 120 }
  // 与 AI 生成并行写库，不再让保存往返阻塞首字（生产 Turso 模式下每次保存为多次远程写）
  void saveMarks()
  if (markAutoGenerate.value) void handleGenerateMarkDetail()
}

/** 手动触发 AI 生成当前标记的解释内容 */
async function handleGenerateMarkDetail() {
  const m = markPopup.mark
  if (!m || markPopup.loading || markPopup.typing) return
  markPopup.loading = true; markPopup.typing = true; markPopup.typingContent = ''
  const para = paragraphs.value.find(p => p.id === m.paragraphId)
  const promptKey = m.type === 'word' ? 'markWord' : m.type === 'phrase' ? 'markPhrase' : 'markSentence'
  const filled = fillPrompt(promptKey, {
    articleContext: article.getArticleContext(),
    paragraphText: para?.text || '',
    selectedText: m.text,
  })
  const msgs = [
    { role: 'system' as const, content: filled.system },
    { role: 'user' as const, content: filled.user },
  ]
  let full = ''
  try {
    await deepseek.streamExplain(msgs, (chunk: string) => { full += chunk; markPopup.typingContent = full })
    m.detail = full; markPopup.typing = false; markPopup.loading = false
    // 提取原词
    const lemmaMatch = full.match(/\[LEMMA\]\/(.+?)\/\[\/LEMMA\]/)
    if (lemmaMatch && lemmaMatch[1].trim()) m.lemma = lemmaMatch[1].trim()
  } catch { markPopup.typing = false; markPopup.loading = false }
  saveMarks()
}

function handleShowMark(mark: Mark) {
  markPopup.mark = mark; markPopup.visible = true; markPopup.loading = false; markPopup.typing = false; markPopup.typingContent = ''
  markPopup.position = { x: Math.min(window.innerWidth - 420, 400), y: 120 }
}

/** 保存手动编辑的标记解释内容 */
function handleUpdateDetail(detail: string) {
  const m = markPopup.mark
  if (!m) return
  m.detail = detail
  const idx = marks.value.findIndex(x => x.id === m.id)
  if (idx !== -1) { marks.value[idx].detail = detail; saveMarks() }
}

async function handleUpdateNote(note: string) {
  markPopup.mark.note = note
  const idx = marks.value.findIndex(m => m.id === markPopup.mark.id)
  if (idx !== -1) { marks.value[idx].note = note; saveMarks() }
}

/** 软删除标记：标记保留在数据里但进回收站（deletedAt 非空） */
function handleDeleteMark() {
  const m = markPopup.mark
  const idx = marks.value.findIndex(x => x.id === m.id)
  if (idx !== -1) {
    marks.value[idx] = { ...marks.value[idx], deletedAt: new Date().toISOString() }
    saveMarks()
  }
  markPopup.visible = false
  progressMsg.value = '标记已移入回收站'
  setTimeout(() => { if (progressMsg.value === '标记已移入回收站') progressMsg.value = '' }, 2000)
}

/** 从回收站恢复标记 */
function restoreMark(mark: Mark) {
  const idx = marks.value.findIndex(x => x.id === mark.id)
  if (idx !== -1) {
    const { deletedAt, ...rest } = marks.value[idx]
    marks.value[idx] = rest as Mark
    saveMarks()
  }
}

/** 从回收站彻底删除（不可恢复） */
function permanentDeleteMark(mark: Mark) {
  if (!confirm(`彻底删除该标记「${mark.text}」？此操作不可恢复。`)) return
  marks.value = marks.value.filter(x => x.id !== mark.id)
  saveMarks()
}

/** 回收站保留期：30 天 */
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
/** 自动清理超过保留期的软删除标记 */
function purgeExpiredTrash() {
  const cutoff = Date.now() - TRASH_RETENTION_MS
  const before = marks.value.length
  marks.value = marks.value.filter(m => !m.deletedAt || new Date(m.deletedAt).getTime() > cutoff)
  if (marks.value.length !== before) saveMarks()
}

/** 保存串行化：保证「先创建的快照」先落库，避免 AI 完成后的新快照被旧请求覆盖 */
let saveChain: Promise<any> = Promise.resolve()
function saveMarks() {
  // 调用时立刻快照，防止流式生成期间 marks 变化影响本次请求体
  const snapshot = JSON.parse(JSON.stringify(marks.value))
  saveChain = saveChain
    .then(() => $fetch('/api/text/update', { method: 'POST', body: { id, marks: snapshot } }))
    .catch(() => {})
  return saveChain
}

function handleSetPosition(pid: string) {
  readingPosition.value = { paragraphId: pid, updatedAt: new Date().toISOString() }
  $fetch('/api/text/update', { method: 'POST', body: { id, readingPosition: readingPosition.value } }).catch(() => {})
}

function jumpToReadingPos() {
  const rp = readingPosition.value
  if (!rp) return
  // 有段落内精确位置 → 跳到字符处
  if (typeof rp.charOffset === 'number') {
    const block = document.querySelector(`.para-block[data-id="${rp.paragraphId}"]`)
    const textEl = block?.querySelector('.para-text') as HTMLElement | null
    if (textEl) {
      const rect = getCharRect(textEl, rp.charOffset)
      const pane = articlePane.value
      if (rect && pane) {
        pane.scrollTo({
          top: pane.scrollTop + rect.top - pane.getBoundingClientRect().top - pane.clientHeight * 0.2,
          behavior: 'smooth',
        })
        nextTick(computeFlagPos)
        return
      }
    }
  }
  // 兜底：段落级跳转
  const el = document.querySelector(`[data-id="${rp.paragraphId}"]`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/** 点击顶栏进度圆点 → 选中并跳转到对应段落 */
function jumpToPara(index: number) {
  const p = paragraphs.value[index]
  if (!p) return
  article.setActiveParagraph(p.id)
  nextTick(() => {
    const el = document.querySelector(`.para-block[data-id="${p.id}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      ;(el as HTMLElement).classList.add('note-flash')
      setTimeout(() => (el as HTMLElement).classList.remove('note-flash'), 2000)
    }
  })
}

// ── 小红旗：段落内精确阅读位置标记 ──
const flagPos = ref<{ pid: string; x: number; y: number } | null>(null)

/** 兼容取光标位置 */
function getCaretPoint(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as any
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y)
    if (p) return { node: p.offsetNode, offset: p.offset }
  }
  const r = d.caretRangeFromPoint ? d.caretRangeFromPoint(x, y) : null
  if (r) return { node: r.startContainer, offset: r.startOffset }
  return null
}

/** 计算目标节点在段落文本中的字符偏移 */
function calcCharOffset(container: HTMLElement, targetNode: Node, targetOffset: number): number {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let acc = 0
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (node === targetNode) return acc + targetOffset
    acc += (node.textContent || '').length
  }
  return acc
}

/** 定位段落内 charOffset 字符的视口矩形 */
function getCharRect(container: HTMLElement, charOffset: number): DOMRect | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let acc = 0
  let node: Node | null
  while ((node = walker.nextNode())) {
    const len = (node.textContent || '').length
    if (acc + len > charOffset) {
      const range = document.createRange()
      range.setStart(node, charOffset - acc)
      range.setEnd(node, Math.min(charOffset - acc + 1, len))
      const rect = range.getBoundingClientRect()
      if (rect && (rect.width > 0 || rect.height > 0)) return rect
      return (node.parentElement as HTMLElement)?.getBoundingClientRect() || rect
    }
    acc += len
  }
  return null
}

/** 在当前视口顶部标记阅读位置（小红旗） */
function markCurrentPosition() {
  // ① 有选中文字 → 红旗标记到选区起始位置（更精准）
  const sel = window.getSelection()
  if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0)
    const textEl = (range.startContainer as Node).parentElement?.closest('.para-text') as HTMLElement | null
    if (textEl) {
      const block = textEl.closest('.para-block') as HTMLElement | null
      const pid = block?.dataset.id
      if (pid) {
        const charOffset = calcCharOffset(textEl, range.startContainer, range.startOffset)
        setReadingPosition(pid, charOffset, sel.toString().trim().slice(0, 50))
        return
      }
    }
  }
  // ② 未选中任何文字 → 清除阅读位置（红旗消失）
  clearReadingPosition()
}

/** 清除阅读位置（红旗消失） */
function clearReadingPosition() {
  readingPosition.value = null
  flagPos.value = null
  $fetch('/api/text/update', { method: 'POST', body: { id, readingPosition: null } }).catch(() => {})
}

/** 保存阅读位置并刷新红旗 */
function setReadingPosition(pid: string, charOffset: number, selectedText = '') {
  readingPosition.value = { paragraphId: pid, charOffset, selectedText, updatedAt: new Date().toISOString() }
  $fetch('/api/text/update', { method: 'POST', body: { id, readingPosition: readingPosition.value } }).catch(() => {})
  nextTick(computeFlagPos)
}

/** 计算红旗在段落内的位置 */
function computeFlagPos() {
  const rp = readingPosition.value
  if (!rp || typeof rp.charOffset !== 'number') { flagPos.value = null; return }
  const block = document.querySelector(`.para-block[data-id="${rp.paragraphId}"]`) as HTMLElement | null
  const textEl = block?.querySelector('.para-text') as HTMLElement | null
  if (!block || !textEl) { flagPos.value = null; return }
  const rect = getCharRect(textEl, rp.charOffset)
  const blockRect = block.getBoundingClientRect()
  if (!rect) { flagPos.value = null; return }
  flagPos.value = { pid: rp.paragraphId, x: rect.left - blockRect.left, y: rect.top - blockRect.top }
}

function handlePronounce(word: string) { article.pronounceWord(word) }

// 持久化所有段落的对话历史
function saveChats() {
  const chats = article.getAllParagraphChats()
  if (Object.keys(chats).length === 0) return
  $fetch('/api/text/update', { method: 'POST', body: { id, paragraphChats: chats } }).catch(() => {})
}

async function saveAiMessage(content: string, msgIndex: number) {
  if (!content.trim() || savedMessages.has(msgIndex)) return
  try {
    await $fetch('/api/knowledge/create', {
      method: 'POST',
      body: {
        content: content.trim(),
        sourceId: id,
        sourceTitle: title.value || article.analysis.value?.title || '',
        sourceType: 'ai-chat',
      },
    })
    savedMessages.add(msgIndex)
    setTimeout(() => { savedMessages.delete(msgIndex) }, 2000)
  } catch { /* 静默 */ }
}

function sendQuick(prompt: string) {
  chatInput.value = prompt
  sendChat()
}

async function sendChat() {
  const msg = chatInput.value.trim(); if (!msg || chatLoading.value) return
  const pid = activeParagraphId.value; if (!pid) return
  // 确保 QA 可见并有足够高度
  if (!qaVisible.value) showQa()
  userAdjustedHeight.value = false
  if (answerHeight.value < 80) answerHeight.value = 80
  const para = paragraphs.value.find(p => p.id === pid)
  const ctx = [para ? `段落原文：\n${para.text}` : '', rightPanelContent.value ? `分析内容：\n${rightPanelContent.value}` : ''].filter(Boolean).join('\n\n')
  const um: ChatMessage = { role: 'user', content: msg }; article.addParagraphChatMessage(pid, um); saveChats(); paragraphsWithChats.add(pid); chatLoading.value = true; chatInput.value = ''
  const systemMsg = { role: 'system' as const, content: `你是专注的阅读导师。结合文章背景和当前段落回答用户问题。\n\n文章背景：${article.getArticleContext()}\n\n当前段落上下文：${ctx}` }
  const messages = [systemMsg, ...article.getParagraphChat(pid)]
  let fullReply = ''; startChatStream('')
  try {
    await deepseek.streamExplain(messages, (chunk: string) => { fullReply += chunk; appendChatText(chunk) })
    endChatStream()
    const am: ChatMessage = { role: 'assistant', content: fullReply }; article.addParagraphChatMessage(pid, am); saveChats()
  } catch (e: any) { stopChatStream() }
  finally { chatLoading.value = false; nextTick(() => { if (qaAnswerRef.value) qaAnswerRef.value.scrollTop = qaAnswerRef.value.scrollHeight }) }
}

onUnmounted(() => { /* clickTimer 已移除 */ })
</script>

<style scoped>
.reader-app { display: flex; flex-direction: column; height: 100vh; font-family: 'DM Sans', sans-serif; background: var(--ra-bg, #ffffff); color: #1a1a18; transition: background 0.3s; }

/* 解释全文按钮 */
.ea-btn {
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 8px;
  border: 1px solid #d8d5cd;
  background: #f7f6f3;
  color: #55524a;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.ea-btn:hover:not(:disabled) {
  background: #fff;
  border-color: #3d3591;
  color: #3d3591;
}
.ea-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 「AI 翻译此段」主按钮 */
.ai-translate-btn {
  margin-left: auto;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 14px;
  border-radius: 8px;
  border: 1px solid #3d3591;
  background: #3d3591;
  color: #fff;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.ai-translate-btn:hover:not(:disabled) {
  background: #4a43a8;
  border-color: #4a43a8;
}
.ai-translate-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 翻译区逐句显示 + 高亮联动 */
.trans-section {
  margin-bottom: 14px;
}
.trans-title {
  font-size: 14px;
  font-weight: 700;
  color: #3d3591;
  margin-bottom: 8px;
}
.trans-para {
  line-height: 1.8;
  color: #3a3a36;
}
.trans-para :deep(p) { margin: 0 0 8px; }
.trans-para :deep(p:last-child) { margin-bottom: 0; }
.trans-para :deep(ul),
.trans-para :deep(ol) { padding-left: 1.5em; margin: 4px 0; }
.trans-para :deep(strong) { font-weight: 600; color: #1a1a18; }
.trans-para :deep(.trans-hl) {
  background: #fef08a;
  color: #1a1a18;
  border-radius: 3px;
  padding: 0 2px;
  font-weight: 500;
}

/* 解释加载中 */
.explain-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 20px;
  color: #8a8780;
  font-size: 13px;
}
.explain-spinner {
  width: 28px;
  height: 28px;
  border: 3px solid #d8d5cd;
  border-top-color: #3d3591;
  border-radius: 50%;
  animation: explain-spin 0.8s linear infinite;
}
@keyframes explain-spin {
  to { transform: rotate(360deg); }
}

/* 阅读位置小红旗（段落内绝对定位） */
.para-block {
  position: relative;
}
.pos-flag {
  position: absolute;
  font-size: 16px;
  line-height: 1;
  z-index: 8;
  transform: translateY(-100%);
  pointer-events: none;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.25));
}

/* 选中文字浮动工具条 */
.sel-toolbar {
  position: fixed; z-index: 1500; display: flex; gap: 6px;
  background: #ffffff; border: 0.5px solid rgba(0,0,0,0.1); border-radius: 12px;
  padding: 8px 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.1); transform: translate(-50%, 0);
}
.sel-btn { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 42px; padding: 5px 7px; border: 1.5px solid transparent; border-radius: 9px; background: #f8fafc; cursor: pointer; transition: all 0.12s; }
.sel-label { font-size: 14px; font-weight: 700; color: var(--c); }
.sel-hint { font-size: 10px; color: #a09e97; line-height: 1; }
.sel-btn:hover { background: #ffffff; border-color: var(--c); }

/* 移动端适配：工具条更紧凑，隐藏提示文字，防止溢出屏幕 */
@media (max-width: 600px) {
  .sel-toolbar {
    gap: 3px;
    padding: 6px 8px;
    border-radius: 10px;
    max-width: calc(100vw - 16px);
    flex-wrap: nowrap;
  }
  .sel-btn {
    min-width: 38px;
    padding: 6px 6px;
    -webkit-tap-highlight-color: transparent;
  }
  .sel-label { font-size: 15px; }
  .sel-hint { display: none; }
}

/* 标记高亮 */
:deep(mark) { cursor: pointer; transition: filter 0.12s; }
:deep(mark:hover) { filter: brightness(0.92); }

/* 阅读位置标记 — 淡蓝底色 + 脉冲扩散 */
.para-num.pos-marker {
  background: #93c5fd !important;
  color: #ffffff !important;
  box-shadow: 0 0 0 4px rgba(147,197,253,0.25);
  animation: pulsePos 2s infinite;
}
@keyframes pulsePos {
  0%, 100% { box-shadow: 0 0 0 4px rgba(147,197,253,0.25); }
  50% { box-shadow: 0 0 0 10px rgba(147,197,253,0); }
}

/* 段落编辑区 */
/* ── 段落主体（文字 + 图片竖排）── */
.para-body {
  flex: 1; min-width: 0;
}

/* ── 段落图片 ── */
.para-images {
  display: flex; flex-wrap: wrap; gap: 8px;
  margin-top: 10px; padding-top: 8px;
  border-top: 1px dashed #e8e6e0;
}

.para-images-bar {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
}
.para-images-toggle {
  display: flex; align-items: center; gap: 3px;
  border: none; background: none; cursor: pointer;
  font-size: 0.7rem; color: #aaa; font-family: 'DM Sans', system-ui, sans-serif;
  padding: 2px 4px; border-radius: 3px;
}
.para-images-toggle:hover { color: #555; background: #f0efe9; }
.pi-chevron { transition: transform 0.2s ease; }
.pi-chevron.open { transform: rotate(180deg); }
.para-images-size {
  display: flex; gap: 2px;
}
.para-images-size button {
  width: 20px; height: 20px; border: none; background: none; cursor: pointer;
  color: #ccc; font-size: 8px; border-radius: 50%; transition: all 0.15s;
  display: flex; align-items: center; justify-content: center;
}
.para-images-size button:hover { background: #f0efe9; }
.para-images-size button.active { color: #3d3591; background: rgba(61,53,145,0.08); }

.para-image-wrap {
  position: relative; border-radius: 6px; overflow: hidden;
  cursor: pointer; flex-shrink: 0;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
}
.para-image-wrap img { width: 100%; height: 100%; object-fit: cover; }

/* 小 */
.para-images--sm .para-image-wrap { width: 100px; height: 75px; }
/* 中（默认） */
.para-images--md .para-image-wrap { width: 160px; height: 120px; }
/* 大 */
.para-images--lg .para-image-wrap { width: 240px; height: 180px; }
.para-image-del {
  position: absolute; top: 4px; right: 4px;
  width: 22px; height: 22px; border-radius: 50%;
  border: none; background: rgba(0,0,0,0.55); color: #fff;
  font-size: 14px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity 0.15s;
}
.para-image-wrap:hover .para-image-del { opacity: 1; }
.para-image-del:hover { background: rgba(220,38,38,0.85); }

.para-edit-area {
  font-family: 'Lora', Georgia, serif;
  font-size: 15px; line-height: 1.82;
  color: #1a1a18;
  width: 100%;
  min-width: 100%;
  box-sizing: border-box;
  border: 1.5px solid #3d3591;
  border-radius: 8px;
  padding: 8px 12px;
  resize: none;
  overflow: hidden;
  outline: none;
  background: #fafaf8;
}

/* 编辑预览区 */
.para-edit-preview {
  font-family: 'Lora', Georgia, serif;
  font-size: 15px; line-height: 1.82;
  color: #1a1a18;
  width: 100%; min-height: 60px;
  border: 1.5px dashed #6366f1;
  border-radius: 8px; padding: 10px 14px;
  background: #fafafe;
}
.para-edit-preview :deep(h1),
.para-edit-preview :deep(h2),
.para-edit-preview :deep(h3) {
  font-family: 'Lora', Georgia, serif; font-weight: 600;
  margin: 0.6em 0 0.3em; line-height: 1.4;
}
.para-edit-preview :deep(h2) { font-size: 1.2em; }
.para-edit-preview :deep(h3) { font-size: 1.05em; }
.para-edit-preview :deep(p) { margin: 0.4em 0; }
.para-edit-preview :deep(strong) { font-weight: 600; }
.para-edit-preview :deep(ul), .para-edit-preview :deep(ol) { padding-left: 1.5em; margin: 0.3em 0; }
.para-edit-preview :deep(code) { background: #f1f5f9; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
.para-edit-preview :deep(blockquote) { border-left: 3px solid #c4c1ba; padding-left: 1em; margin: 0.5em 0; color: #64748b; }

/* 显示模式 Markdown 块级元素样式（全局 reset 清掉了浏览器默认值，需补回） */
.para-text :deep(h1), .para-text :deep(h2), .para-text :deep(h3),
.para-text :deep(h4), .para-text :deep(h5), .para-text :deep(h6) {
  font-family: 'Lora', Georgia, serif; font-weight: 600;
  margin: 0.6em 0 0.3em; line-height: 1.4;
}
.para-text :deep(h1) { font-size: 1.4em; }
.para-text :deep(h2) { font-size: 1.2em; }
.para-text :deep(h3) { font-size: 1.05em; }
.para-text :deep(p) { margin: 0.4em 0; }
.para-text :deep(strong) { font-weight: 600; }
.para-text :deep(em) { font-style: italic; }
.para-text :deep(ul), .para-text :deep(ol) { padding-left: 1.5em; margin: 0.3em 0; }
.para-text :deep(code) { background: #f1f5f9; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
.para-text :deep(blockquote) { border-left: 3px solid #6366f1; padding-left: 1em; margin: 0.5em 0; color: #64748b; }
.para-text :deep(pre) { background: #f5f4f0; padding: 0.8em 1em; border-radius: 6px; overflow-x: auto; margin: 0.4em 0; }
.para-text :deep(pre code) { background: none; padding: 0; }
.para-text :deep(img) {
  max-width: 100%; height: auto;
  border-radius: 6px; margin: 8px 0;
  cursor: pointer;
  box-shadow: 0 1px 6px rgba(0,0,0,0.08);
  transition: box-shadow 0.15s;
}
.para-text :deep(img:hover) {
  box-shadow: 0 2px 12px rgba(0,0,0,0.15);
}

.para-action-btn.active { background: #edeafd; color: #3d3591; border-color: rgba(61,53,145,0.2); }

/* 编辑确认按钮 — 绿色 */
.para-action-btn.edit-confirm {
  color: #10b981;
  border-color: #10b981;
  background: #ecfdf5;
}
.para-action-btn.edit-confirm:hover {
  background: #d1fae5;
}

/* 删除按钮 — 红色 */
.para-action-btn--delete {
  color: #ef4444;
  border-color: rgba(239,68,68,0.2);
}
.para-action-btn--delete:hover {
  background: #fef2f2;
  color: #dc2626;
  border-color: rgba(239,68,68,0.3);
}

/* ── 段落插入 ── */
.insert-block {
  margin: 0 0 18px 36px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #f0fdf4;
  border: 1.5px dashed #10b981;
}
.insert-block .para-edit-area {
  border-color: #10b981;
  background: #fff;
}
.insert-block .para-edit-area::placeholder {
  color: #86b89a;
}

.insert-actions {
  display: flex; gap: 8px; margin-top: 8px;
  justify-content: flex-end;
}
.insert-actions button {
  font-family: 'DM Sans', system-ui, sans-serif;
  font-size: 0.78rem; font-weight: 500;
  padding: 5px 14px; border-radius: 6px;
  border: none; cursor: pointer; transition: all 0.15s;
}
.insert-actions .btn-cancel {
  background: #f0efe9; color: #6b6963;
}
.insert-actions .btn-cancel:hover {
  background: #e5e3db;
}
.insert-actions .btn-confirm {
  background: #10b981; color: #fff;
}
.insert-actions .btn-confirm:hover {
  background: #059669;
}

/* 播放中音频波动画 */
.playing-bars {
  display: flex; align-items: flex-end; gap: 2px; height: 12px;
}
.playing-bar {
  width: 2px; background: #3d3591; border-radius: 1px;
  animation: barPulse 0.5s ease-in-out infinite alternate;
}
@keyframes barPulse {
  0% { height: 4px; }
  100% { height: 12px; }
}

/* 行内小 spinner（段落工具条用） */
.mini-spinner-inline {
  width: 13px; height: 13px;
  border: 1.5px solid #e2e8f0;
  border-top-color: #3d3591;
  border-radius: 50%;
  animation: spinInline 0.6s linear infinite;
}

@keyframes spinInline {
  to { transform: rotate(360deg); }
}

/* 按钮内小 spinner（分段/分析后台运行时显示） */
.btn-spinner-sm {
  width: 12px; height: 12px;
  border: 1.5px solid rgba(61, 53, 145, 0.2);
  border-top-color: #3d3591;
  border-radius: 50%;
  animation: spinInline 0.6s linear infinite;
  flex-shrink: 0;
}

/* 问答历史标记 — 序号下方紫色圆点 */
.para-num.has-chat {
  position: relative;
}
.para-num.has-chat::after {
  content: '';
  position: absolute;
  bottom: -5px;
  left: 50%;
  transform: translateX(-50%);
  width: 5px; height: 5px;
  border-radius: 50%;
  background: #3d3591;
}

/* 段落笔记标记 — 序号右上角琥珀色圆点 */
.para-num.has-note {
  position: relative;
}
.para-num.has-note::before {
  content: '';
  position: absolute;
  top: -2px;
  right: -2px;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #f59e0b;
  border: 1.5px solid #ffffff;
  z-index: 1;
}

/* ---- QA 浮动区 ---- */
.qa-panel { position: relative; }

.qa-area {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: #f0efe9;
  border-top: 0.5px solid rgba(0,0,0,0.08);
  box-shadow: 0 -4px 12px rgba(0,0,0,0.06);
    z-index: 10;
}

.qa-resize-handle {
  height: 10px;
  cursor: row-resize;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
}
.qa-resize-handle::before,
.qa-resize-handle::after {
  content: '';
  width: 3px; height: 3px;
  border-radius: 50%;
  background: #c4c1ba;
  transition: background 0.15s;
}
/* 中间的点通过 box-shadow 生成 */
.qa-resize-handle::before {
  box-shadow: 6px 0 0 #c4c1ba, -6px 0 0 #c4c1ba;
}
.qa-resize-handle:hover::before,
.qa-resize-handle:hover::after {
  background: #3d3591;
}
.qa-resize-handle:hover::before {
  box-shadow: 6px 0 0 #3d3591, -6px 0 0 #3d3591;
}

.qa-answer {
  box-sizing: border-box;
  overflow-y: auto;
  flex: 0 1 auto;
  min-height: 0;
  padding: 8px 14px;
  scrollbar-width: none;
}
.qa-answer::-webkit-scrollbar {
  display: none;
}

/* QA 折叠条 */
.qa-toggle {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 14px; cursor: pointer;
  border-top: 0.5px solid rgba(0,0,0,0.06);
  color: #8a877c; font-size: 12px;
  transition: color 0.15s;
  flex-shrink: 0;
}
.qa-toggle:hover { color: #3d3591; }
.qa-toggle-label { display: flex; align-items: center; gap: 6px; }
.qa-chevron { transition: transform 0.2s; }
.qa-chevron.open { transform: rotate(180deg); }
.qa-top-bar {
  display: flex; align-items: center;
  flex-shrink: 0; padding: 1px;
  justify-content: flex-end;
}
.qa-collapse-btn {
  flex-shrink: 0;
  width: 15px; height: 10px; border: none; border-radius: 3px;
  background: transparent; color: #b0ada0; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.qa-collapse-btn:hover { background: #e8e6df; color: #3d3591; }

/* 快捷提问按钮 */
.qa-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 14px 4px;
}
.qa-quick-btn {
  padding: 4px 10px;
  border: 1px solid rgba(61, 53, 145, 0.15);
  border-radius: 6px;
  background: #faf9fe;
  color: #3d3591;
  font-size: 11px;
  font-family: 'DM Sans', system-ui, sans-serif;
  cursor: pointer;
  transition: all 0.12s;
  white-space: nowrap;
}
.qa-quick-btn:hover { background: #edeafd; border-color: #3d3591; }
.qa-quick-btn:disabled { opacity: 0.4; cursor: default; }

.qa-input-row {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-top: 0.5px solid rgba(0,0,0,0.06);
}

/* typing cursor */
.typing-cursor { display: inline; color: #3d3591; animation: blink 0.8s infinite; font-weight: 100; }
@keyframes blink { 0%,50%{opacity:1} 51%,100%{opacity:0} }

/* QA slide transition */
.qa-slide-enter-active {
  transition: transform 0.25s linear, opacity 0.25s linear;
}
.qa-slide-leave-active {
  transition: transform 0.15s linear, opacity 0.15s linear;
}
.qa-slide-enter-from,
.qa-slide-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
/* ── 书内搜索条 ── */
.search-bar {
  flex-shrink: 0;
  padding: 0 32px 8px;
}
.search-bar-inner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: #f8f9fb;
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 10px;
}
.search-bar-icon { color: #a09e97; flex-shrink: 0; }
.search-bar-input {
  flex: 1;
  border: none; background: transparent;
  font-size: 13px; font-family: 'DM Sans', sans-serif;
  color: #1a1a18; outline: none;
}
.search-bar-input::placeholder { color: #c0bdb4; }
.search-bar-count {
  font-size: 11px;
  color: #a09e97;
  font-family: 'DM Mono', monospace;
  min-width: 32px;
  text-align: center;
}
.search-bar-nav {
  width: 24px; height: 24px;
  border: none; border-radius: 6px;
  background: rgba(0,0,0,0.04);
  color: #6b6963;
  font-size: 11px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.search-bar-nav:hover { background: rgba(0,0,0,0.08); }
.search-bar-nav:disabled { opacity: 0.3; cursor: default; }
.search-bar-close {
  width: 24px; height: 24px;
  border: none; border-radius: 50%;
  background: transparent;
  color: #a09e97;
  font-size: 16px;
  cursor: pointer;
}
.search-bar-close:hover { background: rgba(0,0,0,0.06); }
.search-highlight {
  background: rgba(245, 158, 11, 0.15) !important;
  border-radius: 4px;
  transition: background 0.2s;
}

/* ── 分段粒度下拉 ── */
.segment-size-wrap {
  position: relative;
}
.seg-chevron {
  margin-left: 1px;
  opacity: 0.5;
  transition: transform 0.2s ease;
}
.seg-size-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 170px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
  padding: 6px;
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.seg-size-opt {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 9px 14px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: background 0.12s;
}
.seg-size-opt:hover {
  background: rgba(0, 0, 0, 0.04);
}
.seg-size-opt.active {
  background: #f3f0fd;
}
.seg-size-opt.is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.seg-size-opt.is-disabled:hover {
  background: transparent;
}
.seg-size-label {
  font-size: 13px;
  font-weight: 500;
  color: #1a1a18;
}
.seg-size-hint {
  font-size: 11px;
  color: #a09e97;
  font-family: 'DM Mono', monospace;
}
/* 分段菜单分组标签 */
.seg-size-group-label {
  padding: 6px 14px 2px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #b0ada4;
  font-family: 'DM Sans', sans-serif;
}
.seg-size-group-label:not(:first-child) {
  border-top: 0.5px solid rgba(0, 0, 0, 0.06);
  margin-top: 4px;
}
/* 简单分段：每段句数选择 */
.seg-size-simple {
  border-top: 0.5px solid rgba(0, 0, 0, 0.06);
  margin-top: 2px;
  padding: 8px 10px 4px;
}
.seg-size-simple-label {
  display: block;
  font-size: 11px;
  color: #a09e97;
  margin-bottom: 6px;
  font-family: 'DM Sans', sans-serif;
}
.seg-size-simple-opts {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.seg-size-simple-opt {
  min-width: 30px;
  padding: 4px 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 6px;
  background: #fafaf8;
  color: #6b6963;
  font-size: 12px;
  font-family: 'DM Mono', monospace;
  cursor: pointer;
  transition: all 0.12s;
}
.seg-size-simple-opt:hover {
  border-color: rgba(61, 53, 145, 0.25);
  color: #3d3591;
}
.seg-size-simple-opt.active {
  background: #3d3591;
  border-color: #3d3591;
  color: #ffffff;
}
.seg-drop-enter-active {
  transition: opacity 0.15s, transform 0.15s;
}
.seg-drop-leave-active {
  transition: opacity 0.1s, transform 0.1s;
}
.seg-drop-enter-from,
.seg-drop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ── 全局笔记（播客摘要等）── */
.text-notes-section {
  padding: 14px 0 8px;
  font-size: 13px;
  line-height: 1.75;
  color: #3d3535;
}
.text-notes-section :deep(h1),
.text-notes-section :deep(h2),
.text-notes-section :deep(h3),
.text-notes-section :deep(h4) {
  font-size: 1.05em;
  margin: 12px 0 6px;
  color: #1a1a18;
}
.text-notes-section :deep(p) { margin: 0 0 6px; }
.text-notes-section :deep(ul), .text-notes-section :deep(ol) { padding-left: 18px; margin: 4px 0; }
.text-notes-section :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin: 8px 0;
}
.text-notes-section :deep(th) {
  background: #f0efe9;
  padding: 5px 8px;
  text-align: left;
  font-weight: 600;
  border: 1px solid #e0ddd5;
}
.text-notes-section :deep(td) {
  padding: 5px 8px;
  border: 1px solid #e8e6e0;
  vertical-align: top;
}
.text-notes-section :deep(code) {
  background: rgba(0,0,0,0.05);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 0.9em;
}
/* ── 富文本笔记编辑器 ── */
.notes-editor-wrap {
  border: 1px solid #ebe9e4;
  border-radius: 10px;
  overflow: hidden;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  background: #fff;
  margin-bottom: 16px;
}
.notes-editor-wrap :deep(.re-root) { min-height: 320px; }
.notes-editor-wrap :deep(.re-content) { min-height: 260px; }

/* ── 段落笔记卡片 ── */
.note-card {
  margin-bottom: 14px;
  border: 1px solid #ebe9e4;
  border-radius: 10px;
  overflow: hidden;
  background: #fdfdfc;
}
.note-quote {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px;
  background: #f9f6fc;
  border-bottom: 1px solid #ebe9e4;
}
.note-quote-icon { flex-shrink: 0; margin-top: 2px; color: #a78bfa; }
.note-quote-text {
  flex: 1; font-family: 'Lora', Georgia, serif;
  font-size: 13px; line-height: 1.6; color: #5b5569;
  font-style: italic;
}
.note-jump-btn {
  flex-shrink: 0; width: 24px; height: 24px; border: none; background: none;
  cursor: pointer; color: #b0a8c0; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  transition: color 0.15s, background 0.15s;
}
.note-jump-btn:hover { color: #6366f1; background: rgba(99,102,241,0.08); }

.note-actions {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 12px; border-top: 1px solid #f0efe9;
}
.note-para-label {
  font-size: 10px; color: #b0ada0;
  font-family: 'DM Sans', system-ui, sans-serif;
}
.note-action-btn {
  border: none; background: none; cursor: pointer;
  font-size: 11px; color: #a09e97; font-family: 'DM Sans', system-ui, sans-serif;
  padding: 3px 8px; border-radius: 4px; transition: all 0.15s;
}
.note-action-btn:hover { color: #3d3591; background: #f5f4f0; }
.note-action-btn--delete:hover { color: #ef4444; background: #fef2f2; }

/* 跳转高亮闪烁 */
@keyframes noteFlash {
  0%, 100% { box-shadow: 0 0 0 0 rgba(251,207,232,0); }
  50% { box-shadow: 0 0 0 6px rgba(251,207,232,0.5); }
}
.para-block.note-flash { animation: noteFlash 0.6s ease-in-out 3; }

.notes-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 14px 0 8px;
  color: #a09e97;
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.notes-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgba(0,0,0,0.06);
}

/* ── 每段落笔记 ── */
.note-para-chip {
  margin-left: auto;
  padding: 2px 10px;
  border-radius: 10px;
  background: #f0eefb;
  color: #3d3591;
  font-size: 11px;
  font-weight: 500;
  font-family: 'DM Sans', system-ui, sans-serif;
}
.note-editor--para {
  min-height: 260px;
  margin-bottom: 0;
}
.note-editor--para :deep(.re-root) { min-height: 260px; }
.note-editor--para :deep(.re-content) { min-height: 210px; }
.note-preview-text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 1.5;
  color: #6b6963;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.note-card--index {
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.note-card--index:hover {
  border-color: rgba(61, 53, 145, 0.25);
  background: #faf9ff;
}
/* ── 重叠标记：上层透明度递减 ── */
:deep(mark.hl-top) {
  border-bottom-style: dashed;
}

/* 阅读区自适应 */
.reader-body { display: flex; flex-direction: row; overflow: hidden; }
.reader-article-pane { flex: 1; overflow-y: auto; min-width: 0; }
.reader-panel { width: 40%; min-width: 320px; max-width: 500px; flex-shrink: 0; }

/* 面板推拉按钮 */
.reader-panel { position: relative; overflow: visible; }
.reader-panel.hidden { width: 0 !important; min-width: 0 !important; max-width: 0 !important; overflow: visible; background: transparent; border: none; }
.reader-panel.hidden > :not(.panel-toggle) { display: none; }
.panel-toggle {
  position: absolute; top: 8px; left: -12px; z-index: 210;
  width: 24px; height: 24px;
  display: flex !important; align-items: center; justify-content: center;
  background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 50%;
  cursor: pointer; color: #8a8880; transition: all 0.2s;
}
.panel-toggle:hover { color: #3d3591; border-color: rgba(61,53,145,0.3); }
.reader-panel.hidden .panel-toggle { left: -24px; display: flex !important; }
.reader-panel:not(.hidden) .panel-toggle { display: flex !important; }

@media (max-width: 767px) {
  /* panel-toggle removed — 窄屏使用底部横条 */
}

/* 窄屏底部横条：宽屏隐藏 */
.panel-bottom-bar { display: none; }

/* 面板内容包装器：宽屏正常流式 */
.panel-inner {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

/* ── 手机端适配 ── */
/* 顶栏紧凑模式（<1152px 或触屏设备）：标题/段落进度隐藏，功能按钮收进「⋯」竖排下拉（带文字标签）；宽屏保持横向排列 */
.topbar-actions { display: contents; }
.topbar-more-btn { display: none; }
.tb-label { display: none; }
.reader-topbar.topbar-compact .reader-title-center { display: none; }
.reader-topbar.topbar-compact .topbar-actions { display: none; }
.reader-topbar.topbar-compact .topbar-actions.open {
  display: block;
  position: absolute; top: 46px; right: 8px; left: auto; width: 178px; z-index: 850;
  background: #ffffff; border: 0.5px solid rgba(0,0,0,0.1); border-radius: 12px;
  padding: 6px; box-shadow: 0 10px 30px rgba(0,0,0,0.16);
}
.reader-topbar.topbar-compact .topbar-actions.open .reader-icon-btn {
  display: flex; width: 100%; height: auto;
  align-items: center; gap: 8px; justify-content: flex-start; text-align: left;
  padding: 8px 10px; border-radius: 8px;
  border: none; background: transparent;
  color: #55534d;
}
.reader-topbar.topbar-compact .topbar-actions.open .reader-icon-btn:hover { background: #f0efe9; }
.reader-topbar.topbar-compact .topbar-actions.open .tb-label {
  display: inline; font-size: 13px; font-weight: 500; color: inherit;
  font-family: 'DM Sans', system-ui, sans-serif; white-space: nowrap;
}
.reader-topbar.topbar-compact .topbar-actions.open .segment-size-wrap { width: 100%; }
.reader-topbar.topbar-compact .topbar-actions.open .seg-size-menu {
  position: static; width: 100%; min-width: 0; box-shadow: none; border: none; padding: 4px 0 4px 10px;
}
/* 触发按钮：书本图标 + 「功能」+ 箭头（白底描边胶囊，参考「学习」按钮样式） */
.reader-topbar.topbar-compact .topbar-more-btn {
  display: flex; width: auto; height: auto;
  align-items: center; gap: 7px;
  padding: 8px 14px; border-radius: 10px;
  border: 0.5px solid rgba(0,0,0,0.14); background: #ffffff; color: #44434d;
  font-family: 'DM Sans', system-ui, sans-serif;
}
.reader-topbar.topbar-compact .topbar-more-btn:hover { background: #f5f4f0; }
.reader-topbar.topbar-compact .topbar-more-btn.active { background: #f0efe9; }
.reader-topbar.topbar-compact .more-label { display: inline; font-size: 13px; font-weight: 500; white-space: nowrap; }
.reader-topbar.topbar-compact .more-chevron { transition: transform .15s; }
.reader-topbar.topbar-compact .topbar-more-btn.active .more-chevron { transform: rotate(180deg); }
.topbar-more-btn.active { background: #edeafd; color: #3d3591; }

@media (max-width: 767px) {
  /* dvh = 可视视口动态高度：浏览器地址栏收展时布局始终贴合屏幕，底部横条不会被顶出屏幕 */
  .reader-app { height: 100dvh; }
  .reader-layout { flex-direction: column; flex: 1; min-height: 0; }
  .reader-body { flex-direction: column; flex: 1; min-height: 0; }
  .reader-article-pane { flex: 1 1 0; min-height: 0; width: 100% !important; max-width: 100% !important; padding: 0; overflow-y: auto; }
  .article-body { font-size: 15px; line-height: 1.85; }
  .reader-toolbar { padding: 8px 12px; flex-wrap: wrap; gap: 4px; }
  .reader-toolbar .reader-icon-btn { width: 28px; height: 28px; padding: 4px; }
  .panel-divider.hidden { display: none; }
  .panel-divider { display: none; }
  /* 移动端隐藏阅读赛道竖条（竖向空间有限，且会挤压正文） */
  :deep(.game-rail) { display: none !important; }
  .reader-header { padding: 10px 16px; }
  .reader-header h1 { font-size: 18px; }
  .page-header { padding: 10px 16px; }

  /* 面板改为底部抽屉 */
  .reader-panel {
    position: relative; top: auto; right: auto; bottom: auto; z-index: 100;
    width: 100% !important; min-width: 100% !important; max-width: 100% !important;
    flex-shrink: 0; border-radius: 0; box-shadow: none; overflow: visible;
    display: flex; flex-direction: column;
    border-top: 1px solid rgba(0,0,0,0.08);
    background: #fafaf8;
  }
  .reader-panel.hidden {
    display: none !important;
  }
  .reader-panel.panel-mobile-overlay {
    /* 不再使用 fixed overlay */
    position: relative;
    width: 100% !important; min-width: 100% !important;
    background: #fafaf8; display: flex;
  }

  /* 隐藏宽屏元素 */
  .reader-panel.panel-bottom .panel-toggle { display: none !important; }
  .panel-tabs { display: none; }

  /* 底部横条 */
  .panel-bottom-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    padding-bottom: calc(8px + env(safe-area-inset-bottom));
    gap: 8px;
    flex-shrink: 0;
    position: relative;
    cursor: default;
  }

  /* 桌面端拖拽上边缘：一条不可见的细线 */
  .panel-drag-edge {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 8px;
    cursor: ns-resize;
    z-index: 1;
  }

  /* 底部 tab 按钮 */
  .panel-bottom-tabs {
    display: flex;
    gap: 2px;
  }
  .panel-bottom-tab {
    padding: 5px 12px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: #a09e97;
    font-size: 12.5px;
    font-family: 'DM Sans', system-ui, sans-serif;
    cursor: pointer;
    transition: all 0.15s;
  }
  .panel-bottom-tab.active {
    background: rgba(61,53,145,0.08);
    color: #3d3591;
    font-weight: 500;
  }

  /* 右侧操作区 */
  .panel-bottom-right {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  /* 展开/折叠 chevron */
  .panel-bottom-chevron-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    cursor: pointer;
    color: #c0bdb4;
    transition: color 0.15s, background 0.15s;
  }
  .panel-bottom-chevron-wrap:hover {
    color: #4a4a46;
    background: rgba(0,0,0,0.06);
  }
  .panel-bottom-chevron {
    transition: transform 0.2s ease;
  }
  .panel-bottom-chevron.open {
    transform: rotate(180deg);
  }

  /* 面板内容区 */
  .panel-inner {
    display: none;
    flex: none;
    flex-direction: column;
    overflow: hidden;
    background: #ffffff;
    border-top: 0.5px solid rgba(0,0,0,0.06);
  }
  .panel-bottom--expanded .panel-inner {
    display: flex;
  }

  /* 面板内容滚动区 */
  .reader-panel .panel-content {
    flex: 1;
    overflow-y: auto;
  }
  .reader-panel .panel-scroll {
    height: auto;
    overflow: visible;
  }
}

/* ── 手动分段 / 整理上传 弹窗 ── */
.manual-seg-overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(15, 15, 20, 0.45);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.manual-seg-modal {
  width: 640px; max-width: 100%;
  max-height: 85vh;
  display: flex; flex-direction: column;
  background: #fff; border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  overflow: hidden;
}
.manual-seg-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px;
  font-size: 14px; font-weight: 600; color: #1a1a18;
  border-bottom: 0.5px solid rgba(0,0,0,0.08);
}
.manual-seg-close {
  width: 26px; height: 26px; border: none; background: none;
  font-size: 20px; line-height: 1; color: #a09e97; cursor: pointer;
  border-radius: 6px;
}
.manual-seg-close:hover { background: #f0efe9; color: #1a1a18; }
.manual-seg-body {
  flex: 1; overflow-y: auto;
  padding: 16px 18px;
  display: flex; flex-direction: column; gap: 8px;
}
.manual-seg-label {
  font-size: 12px; color: #6b6963;
}
.manual-seg-textarea {
  width: 100%; min-height: 160px;
  padding: 10px 12px;
  border: 0.5px solid rgba(0,0,0,0.12); border-radius: 8px;
  font-size: 13px; line-height: 1.7; color: #3a3a36;
  font-family: 'DM Mono', 'SF Mono', monospace;
  resize: vertical; outline: none;
  background: #fafaf8;
}
.manual-seg-textarea:focus { border-color: #3d3591; box-shadow: 0 0 0 2px rgba(61,53,145,0.08); }
.manual-seg-textarea.manual-seg-notes { min-height: 110px; }
.manual-seg-input {
  width: 100%;
  padding: 10px 12px;
  border: 0.5px solid rgba(0,0,0,0.12);
  border-radius: 8px;
  font-size: 15px;
  color: #1a1a18;
  font-family: 'DM Mono', monospace;
  outline: none;
  background: #fafaf8;
  box-sizing: border-box;
}
.manual-seg-input:focus { border-color: #3d3591; box-shadow: 0 0 0 2px rgba(61,53,145,0.08); background: #fff; }
.manual-seg-check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 12px;
  color: #6b6963;
  cursor: pointer;
  user-select: none;
}
.manual-seg-checkbox {
  width: 15px;
  height: 15px;
  accent-color: #3d3591;
  cursor: pointer;
}
.manual-seg-count {
  font-size: 11px; color: #8a8880;
}
.manual-seg-warn { color: #f59e0b; margin-left: 6px; }

/* ── 标记回收站 ── */
.reader-icon-btn.has-trash {
  position: relative;
}
.reader-icon-btn.has-trash::after {
  content: '';
  position: absolute;
  top: 5px;
  right: 5px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f59e0b;
  border: 1px solid #fff;
}
.trash-modal {
  max-width: 520px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}
.trash-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.trash-empty {
  color: #c0bdb4;
  font-size: 13px;
  text-align: center;
  padding: 30px 0;
}
.trash-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 10px;
  margin-bottom: 8px;
  background: #fafaf8;
}
.trash-item-info {
  min-width: 0;
}
.trash-item-text {
  font-size: 13px;
  color: #4a4a46;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.trash-item-meta {
  font-size: 11px;
  color: #a09e97;
  margin-top: 2px;
  font-family: 'DM Mono', monospace;
}
.trash-item-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.trash-restore-btn,
.trash-delete-btn {
  padding: 5px 12px;
  border-radius: 7px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: #fff;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.12s;
}
.trash-restore-btn {
  color: #3d3591;
}
.trash-restore-btn:hover {
  background: #f0eefb;
  border-color: rgba(61, 53, 145, 0.25);
}
.trash-delete-btn {
  color: #dc2626;
}
.trash-delete-btn:hover {
  background: #fef2f2;
  border-color: rgba(220, 38, 38, 0.25);
}
.manual-seg-error {
  font-size: 12px; color: #dc2626; background: #fef2f2;
  border-radius: 6px; padding: 6px 10px;
}
.manual-seg-footer {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 12px 18px;
  border-top: 0.5px solid rgba(0,0,0,0.08);
}
.manual-seg-btn {
  padding: 7px 18px; border-radius: 8px;
  font-size: 13px; font-weight: 500; cursor: pointer;
  border: 1px solid transparent; transition: all 0.15s;
  font-family: 'DM Sans', sans-serif;
}
.manual-seg-cancel { background: #f7f6f3; color: #55524a; border-color: #e0ddd5; }
.manual-seg-cancel:hover { background: #fff; }
.manual-seg-save { background: #3d3591; color: #fff; }
.manual-seg-save:hover:not(:disabled) { background: #4a43a8; }
.manual-seg-save:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── 章节目录 ── */
.toc-modal {
  width: 90%;
  max-width: 440px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  padding: 20px 24px;
  box-sizing: border-box;
}
.toc-modal .modal-title {
  font-family: 'Lora', Georgia, serif;
  font-size: 16px;
  font-weight: 600;
  color: #1a1a18;
}
.toc-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  margin-top: 4px;
}
.toc-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  font-size: 13px;
  color: #4a4a46;
  transition: background 0.12s;
}
.toc-item:hover {
  background: #f2f1ec;
}
.toc-item-title {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.toc-item-page {
  flex-shrink: 0;
  font-size: 11px;
  color: #a09e97;
  font-family: 'DM Mono', monospace;
}
.toc-level-0 {
  font-weight: 700;
  font-size: 14px;
  color: #2a2a28;
}
.toc-level-0 .toc-item-title {
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.toc-level-2 {
  padding-left: 26px;
  color: #6a6a66;
}
</style>
