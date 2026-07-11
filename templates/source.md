---
schema_version: 1
id: source-example
type: source
subtype: ""
title: 资料标题
summary: 用 1-2 句概括这份资料讲了什么。
tags: []
source_ids: []
status: active
content_visibility: private
created_at: YYYY-MM-DD
updated_at: YYYY-MM-DD
media_type: text
raw_path: raw/text/example.md
raw_sha256: ""
---

## 摘要
用 3-5 句话概括这份资料讲了什么。
> media_type=image:摘要基于 Agent 对图片的视觉阅读(需当前 Agent 具备视觉能力)。
> media_type=audio:必须额外写 `provenance: transcript-of-audio`;摘要基于转写文字(v1 transcript-only,无内置 ASR)。

## 要点
- 要点 1
- 要点 2

## 衍生页面
- 概念:[[concept-xxx]]
- 实体:[[entity-xxx]]
