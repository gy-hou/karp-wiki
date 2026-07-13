# 多模态个人知识收藏库示例

这是一个“个人知识收藏库”成品示例，演示如何把一张确实包含可读文字的 PNG 图片和一份音频转写稿整理为 source、concept、entity 与 output 页面。当前素材都是占位、非私密示例，五个知识页均标记为 `content_visibility: shareable`。可从 [`wiki/index.md`](wiki/index.md) 查看两份来源如何连接到“间隔重复”“Obsidian”和最终回答。

## 能力边界

1. **文件与 hash 管道是确定性校验。** `node scripts/kb.mjs check --root examples` 会检查文件、`raw_path`、raw bytes 的 SHA-256、schema、引用、index 一致性与隐私门。这类校验不等于理解图片内容。
2. **图片视觉理解依赖运行时 Agent。** 当前 [`raw/images/note-shot.png`](raw/images/note-shot.png) 是生成的、可读的、非私密示例素材，不是真实个人截图；其可见笔记内容包括 “Spaced Repetition”、复习间隔和 “Obsidian”。页面摘要来自已完成的人工视觉检查，但脚本不会断言图片含义。实际使用时，建议把它替换为用户自己的、含可读文字的真实截图，并在具备实际视觉能力的 Agent 运行时重新摄入。
3. **音频仅支持 transcript-only。** [`raw/audio/podcast-clip.transcript.md`](raw/audio/podcast-clip.transcript.md) 是音频转写稿，source 以 `provenance: transcript-of-audio` 明确来源；该文件不等于原始音频，本示例也不声称执行了 ASR。

因此，本示例中的“真实图片”是指实际存在、可读、可进行字节与 hash 校验的图片文件，而不是 1×1 测试 fixture，也不表示它来自真实用户或包含个人信息。
