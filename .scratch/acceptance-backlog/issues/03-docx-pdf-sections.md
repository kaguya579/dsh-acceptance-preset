# 03 docx/pdf 章节层级与 docx 基线列表启发式

Status: needs-triage

## 描述

原生版文档解析的弱项（相对历史 Python 工具）：

1. docx：`sections` 恒为 0（mammoth 纯文本无标题层级），历史版用 python-docx 判 Heading 段落；
2. pdf：同 docx，`sections` 恒为 0；
3. docx 基线：列表识别退化为启发式（`- ` / `• ` / 编号行正则），丢失 Word numPr 列表语义，可能漏掉真正的列表段或误纳正文。

## 建议处置

优先级低（事实包中 sections 是元数据，agent 会读原文取证）。可选方向：docx 改用 mammoth convertToHtml 解析 h1-h6；基线 docx 走同样路径判 li。先观察真实验收场景是否受影响再动。
