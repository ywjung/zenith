/**
 * 한국어 이름을 "성 이름" 순으로 변환.
 * 이름이 정확히 두 단어이고 한글을 포함할 때만 순서를 뒤집음.
 * 예) "용욱 정" → "정 용욱", "Administrator" → "Administrator"
 */
export function formatName(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length === 2 && /[\uAC00-\uD7A3]/.test(name)) {
    return words[1] + ' ' + words[0]
  }
  return name
}

/**
 * ISO 날짜/시간 문자열을 사람이 읽기 쉬운 한국어 상대 시간으로 변환.
 * @param iso - ISO 8601 형식 날짜 문자열
 * @param format - 'relative'(기본): "오늘/N일 전", 'short': "월 일", 'full': 날짜+시간
 */
export function formatDate(
  iso: string,
  format: 'relative' | 'short' | 'full' = 'relative',
): string {
  const d = new Date(iso)
  if (format === 'short') {
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
  }
  if (format === 'full') {
    return d.toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  // relative
  const diff = Date.now() - d.getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return '오늘'
  if (days < 7) return `${days}일 전`
  return `${Math.floor(days / 7)}주 전`
}

/** 파일 크기를 사람이 읽기 쉬운 단위로 변환. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

/** 파일 확장자에 따른 이모지 아이콘 반환. */
export function getFileIcon(name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase()
  const icons: Record<string, string> = {
    pdf: '📄',
    doc: '📝', docx: '📝', txt: '📝',
    xls: '📊', xlsx: '📊', ppt: '📊', pptx: '📊',
    zip: '🗜️', gz: '🗜️', tar: '🗜️',
  }
  return icons[ext] || '📎'
}

/** 이미지 파일 여부 확인. */
export function isImageFile(name: string): boolean {
  const ext = (name.split('.').pop() || '').toLowerCase()
  return new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']).has(ext)
}

/**
 * 마크다운 텍스트를 HTML로 변환 (TipTap 에디터 초기 로딩용).
 * GitLab 마크다운의 주요 패턴만 처리한다.
 */
export function markdownToHtml(md: string): string {
  // 코드 블록(```) 내용은 치환 대상에서 제외하기 위해 플레이스홀더로 교체
  const codeBlocks: string[] = []
  let html = md.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match)
    return `\x00CODE${codeBlocks.length - 1}\x00`
  })

  // HTML 속성 이스케이프 헬퍼
  const escAttr = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
  const safeUrl = (u: string) => /^\s*javascript:/i.test(u) ? '' : escAttr(u)

  // 이미지: ![alt](url) → <img>  (링크보다 먼저 처리)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => `<img src="${safeUrl(src)}" alt="${escAttr(alt)}">`)
  // 링크: [text](url) → <a>
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => `<a href="${safeUrl(href)}">${escAttr(text)}</a>`)

  // 굵게: **text** 또는 __text__  (한 줄 내에서만)
  html = html.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>')
  // 기울임: *text* 또는 _text_  (한 줄 내에서만)
  html = html.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
  html = html.replace(/_([^_\n]+?)_/g, '<em>$1</em>')
  // 인라인 코드: `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // 제목
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // 단락 분리: 빈 줄을 기준으로 <p> 태그 생성
  const blocks = html.split(/\n\n+/)
  html = blocks.map((block) => {
    block = block.trim()
    if (!block) return ''
    // 이미 블록 레벨 태그이거나 플레이스홀더면 그대로
    if (/^(<h[1-6]|<img|<ul|<ol|<li|<blockquote|<pre|\x00CODE)/.test(block)) return block
    return `<p>${block.replace(/\n/g, '<br>')}</p>`
  }).filter(Boolean).join('')

  // 코드 블록 복원 → <pre><code> 태그로 변환
  html = html.replace(/\x00CODE(\d+)\x00/g, (_, i) => {
    const raw = codeBlocks[Number(i)]
    const m = raw.match(/^```(\w*)\n?([\s\S]*?)```$/)
    if (!m) return raw
    const lang = m[1] ? ` class="language-${m[1]}"` : ''
    const escaped = m[2].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `<pre><code${lang}>${escaped}</code></pre>`
  })

  return html
}
